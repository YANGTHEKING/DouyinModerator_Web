import { createEventFingerprint } from "../domain/fingerprint";
import {
  lookupGiftByImageUrl,
  lookupGiftByName,
  normalizeGiftName,
  type GiftCatalogMatch
} from "../domain/giftCatalog";
import { createId } from "../domain/ids";
import type { LiveEvent, PageAdapter, PageSendResult, TriggerSupport, TriggerType } from "../domain/types";

const triggerSupport: Record<TriggerType, TriggerSupport> = {
  member: "partial",
  follow: "partial",
  gift: "partial",
  specificGift: "partial",
  fansclub: "partial",
  like: "partial",
  chatKeyword: "supported"
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return normalizedText(node.textContent ?? "");
  if (node instanceof HTMLElement) return normalizedText(node.innerText || node.textContent || "");
  return "";
}

function trimUserName(value: string): string {
  return value
    .replace(/^(欢迎|恭喜|用户)\s*/u, "")
    .replace(
      /\s*(来了|进入了直播间|进入直播间|加入了直播间|关注了主播|加入了粉丝团|为主播\s*点赞(了)?|点赞(了)?|送出了?|送了|赠送|送).*$/u,
      ""
    )
    .replace(/[：:，,\s]+$/u, "")
    .trim()
    .slice(0, 24);
}

function makeEvent(event: Omit<LiveEvent, "id" | "fingerprint" | "timestamp">): LiveEvent {
  const timestamp = Date.now();
  const source = { ...event, timestamp };
  return {
    ...source,
    id: createId("event"),
    fingerprint: createEventFingerprint(source)
  };
}

function parseCount(text: string): number | undefined {
  const match = text.match(/[xX×]\s*(\d+)/u) ?? text.match(/(\d+)\s*(次|个|下)/u);
  return match ? Number(match[1]) : undefined;
}

function collectImageUrls(element: HTMLElement): string[] {
  const urls = new Set<string>();
  const addUrl = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) urls.add(trimmed);
  };
  const addImage = (image: HTMLImageElement) => {
    addUrl(image.currentSrc);
    addUrl(image.src);
    addUrl(image.getAttribute("src"));
    addUrl(image.getAttribute("data-src"));
    addUrl(image.getAttribute("data-origin-src"));
    const srcset = image.getAttribute("srcset");
    srcset?.split(",").forEach((candidate) => addUrl(candidate.trim().split(/\s+/u)[0]));
  };
  const addStyleUrls = (styleValue: string | null | undefined) => {
    for (const match of styleValue?.matchAll(/url\((['"]?)(.*?)\1\)/giu) ?? []) {
      addUrl(match[2]);
    }
  };

  if (element instanceof HTMLImageElement) addImage(element);
  element.querySelectorAll<HTMLImageElement>("img").forEach(addImage);
  [element, ...Array.from(element.querySelectorAll<HTMLElement>("[style]"))].forEach((styleElement) => {
    addStyleUrls(styleElement.style.backgroundImage);
    addStyleUrls(styleElement.getAttribute("style"));
  });

  return Array.from(urls).slice(0, 24);
}

function extractDiamondCounts(text: string): number[] {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/(\d{1,8})\s*(钻石|钻|抖币)/gu))
        .map((match) => Number(match[1]))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ).sort((a, b) => a - b);
}

const pageGiftLookupCache = new Map<string, { expiresAt: number; match: GiftCatalogMatch | null }>();

function lookupVisiblePageGiftByName(giftName: string | undefined): GiftCatalogMatch | null {
  const normalizedName = normalizeGiftName(giftName);
  if (!normalizedName) return null;

  const now = Date.now();
  const cached = pageGiftLookupCache.get(normalizedName);
  if (cached && cached.expiresAt > now) return cached.match;

  let match: GiftCatalogMatch | null = null;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('[data-e2e*="gift" i], [class*="gift" i], [role="button"], button, li')
  ).slice(0, 600);

  for (const candidate of candidates) {
    const text = normalizedText(candidate.innerText || candidate.textContent || "");
    if (text.length < 2 || text.length > 180) continue;
    if (!/钻|抖币/u.test(text)) continue;
    if (!normalizeGiftName(text).includes(normalizedName)) continue;

    const diamondCountOptions = extractDiamondCounts(text);
    if (!diamondCountOptions.length) continue;
    match =
      diamondCountOptions.length === 1
        ? {
            name: giftName ?? "礼物",
            diamondCount: diamondCountOptions[0],
            source: "page-panel",
            confidence: "exact"
          }
        : {
            name: giftName ?? "礼物",
            diamondCountOptions,
            source: "page-panel",
            confidence: "ambiguous"
          };
    break;
  }

  pageGiftLookupCache.set(normalizedName, { expiresAt: now + 5000, match });
  return match;
}

function lookupGiftForEvent(giftName: string | undefined, element: HTMLElement | undefined): GiftCatalogMatch | null {
  if (element) {
    for (const url of collectImageUrls(element)) {
      const match = lookupGiftByImageUrl(url);
      if (match) return match;
    }
  }

  return lookupVisiblePageGiftByName(giftName) ?? lookupGiftByName(giftName);
}

function makeGiftEvent(rawText: string, giftName: string, count: number | undefined, element?: HTMLElement): LiveEvent {
  const match = lookupGiftForEvent(giftName, element);
  const diamondCount = match?.diamondCount;
  const totalDiamondCount = typeof diamondCount === "number" ? diamondCount * (count ?? 1) : undefined;

  return makeEvent({
    type: "gift",
    userName: trimUserName(rawText) || "用户",
    content: rawText,
    giftName: match?.name ?? giftName,
    count,
    giftDiamondCount: diamondCount,
    giftTotalDiamondCount: totalDiamondCount,
    giftValueSource: match?.source,
    giftValueAmbiguous: match?.confidence === "ambiguous" ? true : undefined,
    giftDiamondCountOptions: match?.diamondCountOptions,
    rawText
  });
}

function parseLiveEventFromText(text: string, element?: HTMLElement): LiveEvent | null {
  const rawText = normalizedText(text);
  if (rawText.length < 2 || rawText.length > 180) return null;
  if (/房管助手|发送队列|自动点赞|导入|导出/u.test(rawText)) return null;

  if (/加入.*粉丝团|入团/u.test(rawText)) {
    return makeEvent({
      type: "fansclub",
      userName: trimUserName(rawText) || "用户",
      content: "加入粉丝团",
      rawText
    });
  }

  if (/关注(了)?主播|关注了/u.test(rawText)) {
    return makeEvent({
      type: "follow",
      userName: trimUserName(rawText) || "用户",
      content: "关注主播",
      rawText
    });
  }

  if (/送出了?|送了|赠送|\s送\s*\S/u.test(rawText)) {
    const giftMatch = rawText.match(/(?:送出了?|送了|赠送|送)\s*([^xX×，,。 ]{1,20})?/u);
    const giftName = giftMatch?.[1] ?? "礼物";
    return makeGiftEvent(rawText, giftName, parseCount(rawText), element);
  }

  if (/点赞/u.test(rawText)) {
    return makeEvent({
      type: "like",
      userName: trimUserName(rawText) || "用户",
      content: "点赞",
      count: parseCount(rawText),
      rawText
    });
  }

  if (/进入(了)?直播间|加入了直播间|进入(了)?房间|来了|来到直播间/u.test(rawText)) {
    return makeEvent({
      type: "member",
      userName: trimUserName(rawText) || "用户",
      content: "进入直播间",
      rawText
    });
  }

  const chatMatch = rawText.match(/^(.{1,24})\s*[：:]\s*(.{1,120})$/u);
  if (chatMatch) {
    return makeEvent({
      type: "chat",
      userName: chatMatch[1].trim() || "用户",
      content: chatMatch[2].trim(),
      rawText
    });
  }

  return null;
}

function parseLiveEventFromElement(element: HTMLElement): LiveEvent | null {
  const nameElement = element.querySelector<HTMLElement>(
    '[class*="name" i], [class*="user" i], [class*="nick" i], [data-e2e*="user" i]'
  );
  const contentElement = element.querySelector<HTMLElement>(
    '[class*="content" i], [class*="message" i], [class*="text" i], [data-e2e*="content" i]'
  );

  const userName = normalizedText(nameElement?.innerText ?? "");
  const content = normalizedText(contentElement?.innerText ?? "");
  if (userName && content && content.length <= 120 && !content.includes("房管助手")) {
    return makeEvent({
      type: "chat",
      userName,
      content,
      rawText: `${userName}: ${content}`
    });
  }

  return parseLiveEventFromText(getText(element), element);
}

function purgeSeen(seen: Map<string, number>, now: number): void {
  for (const [fingerprint, timestamp] of seen) {
    if (now - timestamp > 30000) seen.delete(fingerprint);
  }
}

function findChatInput(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-e2e="chat-input"]') ??
    document.querySelector<HTMLElement>('textarea[placeholder*="说点" i]') ??
    document.querySelector<HTMLElement>('textarea') ??
    document.querySelector<HTMLElement>('[contenteditable="true"]')
  );
}

function setInputText(input: HTMLElement, text: string): void {
  input.focus();

  if (input instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, text);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return;
  }

  if (input instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, text);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.execCommand("insertText", false, text);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function findSendButton(): HTMLButtonElement | null {
  const selectorButton =
    document.querySelector<HTMLButtonElement>('[data-e2e="chat-send-btn"]') ??
    document.querySelector<HTMLButtonElement>('button[class*="send" i]');

  if (selectorButton) return selectorButton;

  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
    return /发送|send/i.test(button.innerText) || /发送|send/i.test(button.getAttribute("aria-label") ?? "");
  }) ?? null;
}

function dispatchEnter(input: HTMLElement): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
}

function findLikeButton(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-e2e*="like" i]') ??
    Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']")).find((element) => {
      const text = `${element.innerText} ${element.getAttribute("aria-label") ?? ""}`;
      return /点赞|喜欢|like/i.test(text);
    }) ??
    null
  );
}

function dispatchDoubleClick(element: Element): void {
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
  element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX, clientY }));
}

export function createDouyinPageAdapter(): PageAdapter {
  return {
    observeInteractionFeed(onEvent) {
      const seen = new Map<string, number>();

      const inspectNode = (node: Node) => {
        if (!(node instanceof HTMLElement) && node.nodeType !== Node.TEXT_NODE) return;
        const event =
          node instanceof HTMLElement
            ? parseLiveEventFromElement(node)
            : parseLiveEventFromText(getText(node), node.parentElement ?? undefined);
        if (!event) return;

        const now = Date.now();
        purgeSeen(seen, now);
        if (seen.has(event.fingerprint)) return;
        seen.set(event.fingerprint, now);
        onEvent(event);
      };

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach(inspectNode);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },

    async sendBarrage(text): Promise<PageSendResult> {
      const input = findChatInput();
      if (!input) return { ok: false, error: "未找到弹幕输入框" };

      setInputText(input, text);
      await sleep(160);

      const button = findSendButton();
      if (button && !button.disabled) {
        button.click();
        return { ok: true };
      }

      dispatchEnter(input);
      return { ok: true };
    },

    async sendLike(): Promise<PageSendResult> {
      const likeButton = findLikeButton();
      if (likeButton) {
        likeButton.click();
        return { ok: true };
      }

      const video = document.querySelector("video");
      if (video) {
        dispatchDoubleClick(video);
        await sleep(80);
        dispatchDoubleClick(video);
        return { ok: true };
      }

      return { ok: false, error: "未找到点赞控件或视频区域" };
    },

    getTriggerSupport(trigger) {
      return triggerSupport[trigger];
    }
  };
}
