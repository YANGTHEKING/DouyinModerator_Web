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
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLElement) return node.innerText || node.textContent || "";
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

function userNameFromSystemText(value: string): string {
  return trimUserName(value) || "系统";
}

function parseChatAuthor(value: string): Pick<LiveEvent, "userName" | "fanClubName"> {
  const author = normalizedText(value);
  const parts = author.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2 && parts[0].length <= 12 && !/^(用户|系统)$/u.test(parts[0])) {
    return {
      fanClubName: parts[0],
      userName: parts.slice(1).join(" ") || "系统"
    };
  }

  return { userName: author || "系统" };
}

function parseCompactFanClubAuthor(value: string): Pick<LiveEvent, "userName" | "fanClubName"> | null {
  const author = normalizedText(value);
  const compactMatch = author.match(/^([\p{Script=Han}·・]{2,12})([a-z0-9_@][^\s]{1,32})$/iu);
  if (!compactMatch) return null;

  return {
    fanClubName: compactMatch[1],
    userName: compactMatch[2]
  };
}

function parseMemberAuthor(value: string): Pick<LiveEvent, "userName" | "fanClubName"> {
  const spacedAuthor = parseChatAuthor(value);
  if (spacedAuthor.fanClubName) return spacedAuthor;
  return parseCompactFanClubAuthor(value) ?? spacedAuthor;
}

function trimRepeatedMentionNoise(content: string): string {
  const tokens = normalizedText(content).split(/\s+/u).filter(Boolean);
  while (tokens.length > 1) {
    const lastToken = tokens[tokens.length - 1];
    if (!/^@\S{1,32}$/u.test(lastToken)) break;
    if (!tokens.slice(0, -1).includes(lastToken)) break;
    tokens.pop();
  }

  return tokens.join(" ");
}

function isMentionOnlyContent(content: string): boolean {
  const tokens = normalizedText(content).split(/\s+/u).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => /^@\S{1,32}$/u.test(token));
}

function normalizeChatContent(content: string): string | null {
  const cleaned = trimRepeatedMentionNoise(content);
  if (!cleaned || isMentionOnlyContent(cleaned)) return null;

  return cleaned;
}

function textLines(value: string): string[] {
  return value.split(/[\r\n]+/u).map(normalizedText).filter(Boolean);
}

function isLikelyFanClubLine(value: string): boolean {
  return value.length >= 2 && value.length <= 12 && !/[：:@]/u.test(value);
}

function isMemberActionLine(value: string): boolean {
  return /^(进入|进入了直播间|进入直播间|加入了直播间|进入了房间|进入房间|来了|来到直播间)$/u.test(
    normalizedText(value)
  );
}

function trimMemberActionText(value: string): string {
  return normalizedText(value)
    .replace(/^(欢迎|恭喜|用户|进入)\s*/u, "")
    .replace(/\s*(进入了直播间|进入直播间|加入了直播间|进入了房间|进入房间|来了|来到直播间).*$/u, "")
    .replace(/[：:，,\s]+$/u, "")
    .trim();
}

function parseMemberAuthorFromText(text: string, rawText: string): Pick<LiveEvent, "userName" | "fanClubName"> {
  const lines = textLines(text);
  for (const line of lines) {
    if (isMemberActionLine(line)) continue;

    const candidate = trimMemberActionText(line);
    if (!candidate || isMemberActionLine(candidate)) continue;
    return parseMemberAuthor(candidate);
  }

  return parseMemberAuthor(trimMemberActionText(rawText) || userNameFromSystemText(rawText));
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

function makeChatEvent(author: string, content: string, rawText: string, fanClubName?: string): LiveEvent | null {
  const normalizedContent = normalizeChatContent(content);
  if (!normalizedContent) return null;

  return makeEvent({
    type: "chat",
    ...parseChatAuthor(fanClubName ? `${fanClubName} ${author}` : author),
    content: normalizedContent,
    rawText
  });
}

function parseChatEvent(text: string, rawText: string): LiveEvent | null {
  const lines = textLines(text);
  const chatLineIndex = lines.findIndex((line) => /^.{1,48}\s*[：:]\s*.{1,140}$/u.test(line));
  if (chatLineIndex >= 0) {
    const chatLineMatch = lines[chatLineIndex].match(/^(.{1,48})\s*[：:]\s*(.{1,140})$/u);
    if (!chatLineMatch) return null;
    const fanClubName =
      chatLineIndex > 0 && isLikelyFanClubLine(lines[chatLineIndex - 1]) ? lines[chatLineIndex - 1] : undefined;
    const trailingContent = lines.slice(chatLineIndex + 1).join(" ");
    return makeChatEvent(chatLineMatch[1], `${chatLineMatch[2]} ${trailingContent}`, rawText, fanClubName);
  }

  const chatMatch = rawText.match(/^(.{1,48})\s*[：:]\s*(.{1,140})$/u);
  if (!chatMatch) return null;

  return makeChatEvent(chatMatch[1], chatMatch[2], rawText);
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
  if (normalizedName.length < 2) return null;

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

function makeSystemEvent(rawText: string): LiveEvent {
  return makeEvent({
    type: "system",
    userName: "系统",
    content: rawText,
    rawText
  });
}

function hasStrongGiftEvidence(giftName: string, match: GiftCatalogMatch | null): boolean {
  const trimmedGiftName = giftName.trim();
  if (match?.source === "catalog-image" || match?.source === "page-panel") return true;
  if (/^[a-z0-9]$/iu.test(trimmedGiftName)) return false;
  if (match?.source === "catalog-name" && match.confidence === "ambiguous") return false;
  return true;
}

function makeGiftEvent(rawText: string, giftName: string, count: number | undefined, element?: HTMLElement): LiveEvent {
  const match = lookupGiftForEvent(giftName, element);
  if (!hasStrongGiftEvidence(giftName, match)) return makeSystemEvent(rawText);

  const diamondCount = match?.diamondCount;
  const totalDiamondCount = typeof diamondCount === "number" ? diamondCount * (count ?? 1) : undefined;

  return makeEvent({
    type: "gift",
    userName: userNameFromSystemText(rawText),
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

  const chatEvent = parseChatEvent(text, rawText);
  if (chatEvent) return chatEvent;

  if (/加入.*粉丝团|入团/u.test(rawText)) {
    return makeEvent({
      type: "fansclub",
      userName: userNameFromSystemText(rawText),
      content: "加入粉丝团",
      rawText
    });
  }

  if (/关注(了)?主播|关注了/u.test(rawText)) {
    return makeEvent({
      type: "follow",
      userName: userNameFromSystemText(rawText),
      content: "关注主播",
      rawText
    });
  }

  if (/送出了?|送了|赠送|\s送\s*\S/u.test(rawText)) {
    const giftMatch = rawText.match(/(?:送出了?|送了|赠送|送)\s*([^xX×，,。 ]{1,20})/u);
    const giftName = giftMatch?.[1] ?? "礼物";
    return makeGiftEvent(rawText, giftName, parseCount(rawText), element);
  }

  if (/点赞/u.test(rawText)) {
    return makeEvent({
      type: "like",
      userName: userNameFromSystemText(rawText),
      content: "点赞",
      count: parseCount(rawText),
      rawText
    });
  }

  if (/进入(了)?直播间|加入了直播间|进入(了)?房间|来了|来到直播间/u.test(rawText)) {
    return makeEvent({
      type: "member",
      ...parseMemberAuthorFromText(text, rawText),
      content: "进入直播间",
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
  const content = normalizeChatContent(contentElement?.innerText ?? "");
  if (userName && content && content.length <= 120 && !content.includes("房管助手")) {
    return makeEvent({
      type: "chat",
      ...parseChatAuthor(userName),
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
  const selectors = [
    '[data-e2e="chat-input"] textarea',
    '[data-e2e="chat-input"] input',
    '[data-e2e="chat-input"] [contenteditable="true"]',
    '[data-e2e="chat-input"] [contenteditable="plaintext-only"]',
    'textarea[placeholder*="说点" i]',
    'input[placeholder*="说点" i]',
    'textarea',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]'
  ];

  for (const selector of selectors) {
    const candidate = document.querySelector<HTMLElement>(selector);
    if (candidate && isEditableInput(candidate) && isVisibleElement(candidate)) return candidate;
  }

  const chatInputRoot = document.querySelector<HTMLElement>('[data-e2e="chat-input"]');
  const nestedInput = chatInputRoot?.querySelector<HTMLElement>(
    'textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]'
  );
  if (nestedInput && isEditableInput(nestedInput) && isVisibleElement(nestedInput)) return nestedInput;

  return null;
}

function isEditableInput(input: HTMLElement): boolean {
  return (
    input instanceof HTMLTextAreaElement ||
    input instanceof HTMLInputElement ||
    input.isContentEditable ||
    input.getAttribute("contenteditable") === "true" ||
    input.getAttribute("contenteditable") === "plaintext-only"
  );
}

function isVisibleElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && (rect.width > 0 || rect.height > 0);
}

function dispatchInputEvents(input: HTMLElement, inputType: string, data: string | null): void {
  input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, data }));
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeTextControlValue(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, "");
  dispatchInputEvents(input, "deleteContentBackward", null);
  setter?.call(input, text);
  dispatchInputEvents(input, "insertText", text);
  try {
    input.setSelectionRange(text.length, text.length);
  } catch {
    // Some input types do not expose text selection. The value has already been written.
  }
}

function setContentEditableText(input: HTMLElement, text: string): void {
  const selection = window.getSelection();
  const range = document.createRange();
  input.focus();
  range.selectNodeContents(input);
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.execCommand("delete", false);
  input.textContent = "";
  dispatchInputEvents(input, "deleteContentBackward", null);

  const insertRange = document.createRange();
  insertRange.selectNodeContents(input);
  insertRange.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(insertRange);
  const inserted = document.execCommand("insertText", false, text);
  if (!inserted || normalizedText(readInputText(input)) !== normalizedText(text)) {
    input.textContent = text;
  }
  dispatchInputEvents(input, "insertText", text);
}

function setInputText(input: HTMLElement, text: string): void {
  input.focus();

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    setNativeTextControlValue(input, text);
    return;
  }

  setContentEditableText(input, text);
}

function readInputText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) return input.value;
  return input.innerText || input.textContent || "";
}

function inputContainsText(input: HTMLElement, text: string): boolean {
  return normalizedText(readInputText(input)) === normalizedText(text);
}

function isUsableActionElement(element: HTMLElement): boolean {
  if (!isVisibleElement(element)) return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element.hasAttribute("disabled")) return false;
  return true;
}

function findSendButton(input: HTMLElement): HTMLElement | null {
  const roots = [
    input.closest("form"),
    input.closest<HTMLElement>('[data-e2e*="chat" i], [class*="chat" i], [class*="comment" i], [class*="input" i]'),
    document.body
  ].filter((root): root is HTMLElement => Boolean(root));

  for (const root of roots) {
    const selectorButton =
      root.querySelector<HTMLElement>('[data-e2e="chat-send-btn"]') ??
      root.querySelector<HTMLElement>('button[class*="send" i], [role="button"][class*="send" i]');
    if (selectorButton && isUsableActionElement(selectorButton)) return selectorButton;

    const textButton = Array.from(root.querySelectorAll<HTMLElement>("button, [role='button']")).find((button) => {
      const buttonText = `${button.innerText} ${button.getAttribute("aria-label") ?? ""}`;
      return /发送|send/i.test(buttonText) && isUsableActionElement(button);
    });
    if (textButton) return textButton;
  }

  return null;
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
      if (!inputContainsText(input, text)) {
        return { ok: false, error: "弹幕输入框写入失败" };
      }

      const button = findSendButton(input);
      if (!button) return { ok: false, error: "未找到可用发送按钮，已避免回车产生空行" };

      button.click();
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
