import { createEventFingerprint } from "../domain/fingerprint";
import {
  extractGiftImageKey,
  lookupGiftByImageUrl,
  lookupGiftByName,
  normalizeGiftName,
  type GiftCatalogMatch
} from "../domain/giftCatalog";
import { createId } from "../domain/ids";
import type { LiveEvent, PageAdapter, PageSendResult, TriggerSupport, TriggerType } from "../domain/types";
import { learnGiftCatalogEntry } from "../storage/learnedGiftCatalogStorage";

const triggerSupport: Record<TriggerType, TriggerSupport> = {
  member: "partial",
  follow: "partial",
  gift: "partial",
  specificGift: "partial",
  fansclub: "partial",
  like: "partial",
  monthlyMember: "partial",
  annualMember: "partial",
  starGuardian: "partial",
  chatKeyword: "supported"
};

const sendCompletionTimeoutMs = 5000;
const sendCompletionPollMs = 50;
const chatInputPlaceholderFallback = "说点什么";
const contentEditableStabilizationPollDelaysMs = [25, 75, 150, 300, 600, 1200];
const contentEditablePostFillCleanupDelaysMs = [250, 750, 1500, 3000, 6000];
const inputClearBeforeWritePollDelaysMs = [0, 30, 80, 160, 320];
const sendButtonPollDelaysMs = [0, 50, 120, 250, 500];
const nearbySendButtonMaxDistancePx = 220;
const nearbySendButtonMaxVerticalOffsetPx = 80;
const nearbySendButtonMaxSizePx = 96;
const giftPanelLearningIntervalMs = 5000;
const maxGiftPanelLearningLines = 6;
const maxGiftPanelImageKeys = 3;
const unknownGiftImageKeyPrefixLength = 8;
const unknownGiftNamePrefix = "未知礼物";
const giftPanelCandidateSelector = '[data-e2e*="gift" i], [class*="gift" i], [role="button"], button, li';
const interactionFeedSelector =
  '[class*="webcast-chatroom"], [class*="chatroom" i], [data-e2e*="chat" i], [data-e2e*="message" i]';
const ignoredInteractionOverlaySelector =
  '[class*="GiftTrayPlugin"], [class*="LivePlayer"], [class*="douyin-player"], [class*="__livingPlayer__"], [class*="pip-anchor"]';
const ordinaryTextColorCacheMs = 1500;
const giftActionTextColorDistanceThreshold = 75;
const giftAccentSaturationThreshold = 0.2;

type ClickableElement = HTMLElement | SVGElement;

interface ViewportPoint {
  x: number;
  y: number;
}

interface TrustedClickResponse {
  ok: boolean;
  error?: string;
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface MembershipAction {
  type: Extract<LiveEvent["type"], "monthlyMember" | "annualMember" | "starGuardian">;
  label: string;
  action: "开通" | "续费";
}

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
      /\s*(来了|进入了直播间|进入直播间|加入了直播间|关注了主播|加入了粉丝团|开通(了)?\s*(月度会员|月会员|年度会员|年会员|星守护)|续费(了)?\s*(月度会员|月会员|年度会员|年会员|星守护)|为主播\s*(点赞(了)?|(加|增加)了\s*\d*\s*分)|点赞(了)?|送出了?|送了|赠送|送).*$/u,
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
  const match = text.match(/[xX×]\s*(\d+)/u) ?? text.match(/(\d+)\s*(次|个|下|分)/u);
  return match ? Number(match[1]) : undefined;
}

const giftActionPattern = /(?:送出\s*了|送\s*了|赠送\s*了?)/u;
const giftInlineActionPattern = /(?:^|[\s：:])(?:送出\s*了|送\s*了|赠送\s*了?|送(?!出|\s*了))/u;
const giftActionOnlyPattern = /^(?:送出\s*了|送\s*了|赠送\s*了?|送)$/u;
const invalidExtractedGiftNamePattern = /^(?:了|礼物|未知礼物|用户|系统|送出|送了|赠送|送)$/u;

function hasGiftActionText(value: string): boolean {
  const text = normalizedText(value);
  return giftActionPattern.test(text) || /(^|\s)送(?!出|\s*了)\s*\S/u.test(text);
}

function hasStrongGiftActionText(value: string): boolean {
  return giftActionPattern.test(normalizedText(value));
}

function parseMembershipAction(value: string): MembershipAction | null {
  const text = normalizedText(value).replace(/^恭喜\s*/u, "");
  const actionMatch = text.match(/(开通|续费)(?:了)?\s*(月度会员|月会员|年度会员|年会员|星守护)/u);
  if (!actionMatch) return null;

  const action = actionMatch[1] as MembershipAction["action"];
  const target = actionMatch[2];
  if (/月度会员|月会员/u.test(target)) {
    return { type: "monthlyMember", label: `${action}月度会员`, action };
  }
  if (/年度会员|年会员/u.test(target)) {
    return { type: "annualMember", label: `${action}年度会员`, action };
  }

  return { type: "starGuardian", label: `${action}星守护`, action };
}

function isMembershipActionText(value: string): boolean {
  return Boolean(parseMembershipAction(value));
}

function parseCssColor(value: string): RgbaColor | null {
  if (!value || value === "transparent") return null;
  const match = value.match(/^rgba?\((.+)\)$/u);
  if (!match) return null;

  const parts = match[1]
    .replace(/\//gu, " ")
    .split(/[,\s]+/u)
    .filter(Boolean);
  if (parts.length < 3) return null;

  const [r, g, b] = parts.slice(0, 3).map((part) => {
    const number = Number.parseFloat(part);
    return part.endsWith("%") ? (number / 100) * 255 : number;
  });
  const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
  if (![r, g, b, alpha].every(Number.isFinite)) return null;

  return {
    r: Math.max(0, Math.min(255, r)),
    g: Math.max(0, Math.min(255, g)),
    b: Math.max(0, Math.min(255, b)),
    a: Math.max(0, Math.min(1, alpha))
  };
}

function colorKey(color: RgbaColor): string {
  return [color.r, color.g, color.b].map((channel) => Math.round(channel / 8) * 8).join(",");
}

function colorDistance(left: RgbaColor, right: RgbaColor): number {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

function colorSaturation(color: RgbaColor): number {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max <= 0 ? 0 : (max - min) / max;
}

function isGiftAccentColor(color: RgbaColor | null): boolean {
  if (!color || color.a < 0.1) return false;
  return colorSaturation(color) >= giftAccentSaturationThreshold && Math.max(color.r, color.g, color.b) >= 110;
}

let ordinaryTextColorCache: { expiresAt: number; color: RgbaColor | null } = { expiresAt: 0, color: null };

function isOrdinaryChatTextSample(element: HTMLElement, text: string): boolean {
  if (text.length < 2 || text.length > 80) return false;
  if (element.closest("#douyin-moderator-web-root")) return false;
  if (/房管助手|发送队列|自动点赞|导入|导出|在线观众|高等级用户|贡献用户|本场点赞/u.test(text)) {
    return false;
  }
  if (/送出了?|送了|赠送|点赞|进入(了)?直播间|加入了直播间|关注(了)?主播|粉丝团|钻|抖币/u.test(text)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function inferOrdinaryTextColor(): RgbaColor | null {
  const now = Date.now();
  if (ordinaryTextColorCache.expiresAt > now) return ordinaryTextColorCache.color;

  const buckets = new Map<string, { color: RgbaColor; score: number }>();
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("span, div, p")).slice(-1200);
  for (const candidate of candidates) {
    const text = normalizedText(candidate.innerText || candidate.textContent || "");
    if (!isOrdinaryChatTextSample(candidate, text)) continue;

    const color = parseCssColor(window.getComputedStyle(candidate).color);
    if (!color || color.a < 0.1) continue;
    const key = colorKey(color);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.score += Math.max(1, Math.min(text.length, 20));
    } else {
      buckets.set(key, { color, score: Math.max(1, Math.min(text.length, 20)) });
    }
  }

  const color =
    Array.from(buckets.values()).sort((left, right) => right.score - left.score)[0]?.color ?? null;
  ordinaryTextColorCache = { expiresAt: now + ordinaryTextColorCacheMs, color };
  return color;
}

function isDifferentFromOrdinaryTextColor(color: RgbaColor | null): boolean {
  if (!color || color.a < 0.1) return false;
  const ordinaryColor = inferOrdinaryTextColor();
  if (!ordinaryColor) return isGiftAccentColor(color);
  return colorDistance(color, ordinaryColor) >= giftActionTextColorDistanceThreshold;
}

function elementHasGiftColorEvidence(element: HTMLElement, boundary: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const style = window.getComputedStyle(current);
    const textColor = parseCssColor(style.color);
    const backgroundColor = parseCssColor(style.backgroundColor);

    if (isGiftAccentColor(textColor) || isDifferentFromOrdinaryTextColor(textColor)) return true;
    if (isGiftAccentColor(backgroundColor)) return true;

    if (current === boundary) break;
    current = current.parentElement;
  }

  return false;
}

function hasGiftColorEvidence(element: HTMLElement | undefined, contentElement?: HTMLElement | null): boolean {
  if (!element) return false;
  const root = contentElement ?? element;
  const actionElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].filter((candidate) =>
    hasGiftActionText(normalizedText(candidate.innerText || candidate.textContent || ""))
  );
  if (!actionElements.length) return false;

  return actionElements.some((actionElement) => elementHasGiftColorEvidence(actionElement, element));
}

function hasMembershipColorEvidence(element: HTMLElement | undefined, contentElement?: HTMLElement | null): boolean {
  if (!element) return false;
  const root = contentElement ?? element;
  const actionElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].filter((candidate) =>
    isMembershipActionText(normalizedText(candidate.innerText || candidate.textContent || ""))
  );
  if (!actionElements.length) return false;

  return actionElements.some((actionElement) => elementHasGiftColorEvidence(actionElement, element));
}

function hasRecognizedGiftImageEvidence(element: HTMLElement | undefined): boolean {
  if (!element) return false;
  return collectImageUrls(element).some((url) => Boolean(lookupGiftByImageUrl(url)));
}

function hasGiftVisualEvidence(element: HTMLElement | undefined, contentElement?: HTMLElement | null): boolean {
  return hasGiftColorEvidence(element, contentElement) || hasRecognizedGiftImageEvidence(element);
}

function isLikeActionText(value: string): boolean {
  const text = normalizedText(value);
  return (
    /^(为主播\s*)?点赞(了)?(\s*\d+\s*(次|个|下))?$/u.test(text) ||
    /^(?:\S{1,32}\s+)?为主播\s*(?:加|增加)了\s*\d+\s*分(?:\s+(?:\S{1,32}\s+)?为主播\s*(?:加|增加)了\s*\d+\s*分)*$/u.test(
      text
    )
  );
}

function isSystemNoticeText(value: string): boolean {
  const text = normalizedText(value);
  return /^恭喜.{1,48}(?:成为\s*No\.?\s*\d+\s*本场\s*\d+\s*贡献用户|刚刚升级至\s*Lv\.?\s*\d+)/u.test(
    text
  );
}

function cleanExtractedGiftName(value: string): string {
  return normalizedText(value)
    .replace(/^(?:了|礼物)\s+/u, "")
    .replace(/\s*价值(?:待确认|已确认)?.*$/u, "")
    .replace(/\s*(?:[xX×]\s*\d+|[，,。.!！?？·].*)$/u, "")
    .replace(/[：:，,。.!！?？"'“”‘’]+$/gu, "")
    .trim();
}

function isLikelyExtractedGiftName(value: string): boolean {
  const name = cleanExtractedGiftName(value);
  if (!name || name.length > 24) return false;
  if (invalidExtractedGiftNamePattern.test(name)) return false;
  if (/^[xX×]?\s*\d+$/u.test(name)) return false;
  if (giftActionOnlyPattern.test(name)) return false;
  return true;
}

function extractGiftNameFromActionText(text: string): string | null {
  const normalized = normalizedText(text);
  const actionMatch = normalized.match(giftInlineActionPattern);
  if (!actionMatch || actionMatch.index === undefined) return null;
  const textAfterAction = normalized.slice(actionMatch.index + actionMatch[0].length).trimStart();
  if (!textAfterAction || /^[xX×]/u.test(textAfterAction)) return null;
  const name = cleanExtractedGiftName(textAfterAction.slice(0, 48));
  return isLikelyExtractedGiftName(name) ? name : null;
}

function extractGiftNameAfterStandaloneAction(lines: readonly string[], actionLineIndex: number): string | null {
  const actionLine = lines[actionLineIndex];
  let candidateIndex: number | null = null;

  if (/^送出$/u.test(actionLine)) {
    candidateIndex = lines[actionLineIndex + 1] === "了" ? actionLineIndex + 2 : null;
  } else if (giftActionOnlyPattern.test(actionLine)) {
    candidateIndex = actionLineIndex + 1;
  }

  if (candidateIndex === null) return null;
  const name = cleanExtractedGiftName(lines[candidateIndex] ?? "");
  return isLikelyExtractedGiftName(name) ? name : null;
}

function extractGiftNameFromLines(lines: readonly string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!hasGiftActionText(line) && line !== "送出") continue;

    const inlineName = extractGiftNameFromActionText(line);
    if (inlineName) return inlineName;

    const standaloneName = extractGiftNameAfterStandaloneAction(lines, index);
    if (standaloneName) return standaloneName;
  }

  return null;
}

function extractGiftName(text: string): string {
  return extractGiftNameFromLines(textLines(text)) ?? extractGiftNameFromActionText(text) ?? "礼物";
}

function trimAuthorLabel(value: string): string {
  return normalizedText(value).replace(/[：:\s]+$/u, "");
}

function parseGiftAuthorFromText(text: string, rawText: string): Pick<LiveEvent, "userName" | "fanClubName"> | undefined {
  const lines = textLines(text);
  const giftLineIndex = lines.findIndex(hasGiftActionText);
  const giftLine = giftLineIndex >= 0 ? lines[giftLineIndex] : "";
  const inlineAuthor = giftLine.match(/^(.{1,48}?)\s*[：:]\s*(?:送出\s*了?|送\s*了|赠送\s*了?|送)/u)?.[1];
  if (inlineAuthor) {
    const fanClubName =
      giftLineIndex > 0 && isLikelyFanClubLine(lines[giftLineIndex - 1]) ? lines[giftLineIndex - 1] : undefined;
    return parseMemberAuthor(fanClubName ? `${fanClubName} ${inlineAuthor}` : inlineAuthor);
  }

  if (giftLineIndex > 0) {
    const previousAuthor = trimAuthorLabel(lines[giftLineIndex - 1]);
    if (previousAuthor && !hasGiftActionText(previousAuthor)) {
      const fanClubName =
        giftLineIndex > 1 && isLikelyFanClubLine(lines[giftLineIndex - 2]) ? lines[giftLineIndex - 2] : undefined;
      return parseMemberAuthor(fanClubName ? `${fanClubName} ${previousAuthor}` : previousAuthor);
    }
  }

  const rawColonAuthor = rawText.match(/^(.{1,48}?)\s*[：:]\s*(?:送出\s*了?|送\s*了|赠送\s*了?|送)/u)?.[1];
  if (rawColonAuthor) return parseMemberAuthor(rawColonAuthor);

  const rawInlineAuthor = rawText.match(/^(.{1,48}?)\s+(?:送出\s*了?|送\s*了|赠送\s*了?|送)\s*\S/u)?.[1];
  return rawInlineAuthor ? parseMemberAuthor(rawInlineAuthor) : undefined;
}

function parseActionAuthorFromText(
  text: string,
  rawText: string,
  isActionLine: (value: string) => boolean
): Pick<LiveEvent, "userName" | "fanClubName"> {
  for (const line of textLines(text)) {
    if (line === "聊天" || isActionLine(line)) continue;
    const candidate = trimAuthorLabel(line);
    if (candidate) return parseMemberAuthor(candidate);
  }

  return parseMemberAuthor(userNameFromSystemText(rawText).replace(/^聊天\s*/u, "") || "系统");
}

function makeLikeEvent(
  rawText: string,
  author?: Pick<LiveEvent, "userName" | "fanClubName">
): LiveEvent {
  return makeEvent({
    type: "like",
    ...(author ?? { userName: userNameFromSystemText(rawText).replace(/^聊天\s*/u, "") || "系统" }),
    content: "点赞",
    count: parseCount(rawText),
    rawText
  });
}

function makeMembershipEvent(
  rawText: string,
  action: MembershipAction,
  author?: Pick<LiveEvent, "userName" | "fanClubName">
): LiveEvent {
  return makeEvent({
    type: action.type,
    ...(author ?? { userName: userNameFromSystemText(rawText).replace(/^聊天\s*/u, "") || "系统" }),
    content: action.label,
    rawText
  });
}

function makeChatEvent(author: string, content: string, rawText: string, fanClubName?: string): LiveEvent | null {
  const normalizedContent = normalizeChatContent(content);
  if (!normalizedContent) return null;
  const parsedAuthor = parseChatAuthor(fanClubName ? `${fanClubName} ${author}` : author);
  if (isLikeActionText(normalizedContent)) {
    return makeLikeEvent(rawText, parsedAuthor);
  }

  return makeEvent({
    type: "chat",
    ...parsedAuthor,
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

function collectGiftImageKeys(element: HTMLElement | undefined): string[] {
  if (!element) return [];
  return Array.from(new Set(collectImageUrls(element).map(extractGiftImageKey).filter((key): key is string => Boolean(key))));
}

function unknownGiftNameFromImageKeys(imageKeys: readonly string[]): string | null {
  const key = imageKeys[0];
  return key ? `${unknownGiftNamePrefix}-${key.slice(0, unknownGiftImageKeyPrefixLength)}` : null;
}

function resolveGiftNameForEvent(giftName: string, element?: HTMLElement | null): string {
  if (giftName !== "礼物") return giftName;
  return unknownGiftNameFromImageKeys(collectGiftImageKeys(element ?? undefined)) ?? giftName;
}

function collectScopedGiftImageKeys(element: HTMLElement): string[] | null {
  const imageKeys = collectGiftImageKeys(element);
  return imageKeys.length <= maxGiftPanelImageKeys ? imageKeys : null;
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

function cleanGiftPanelName(value: string): string {
  return normalizedText(value)
    .replace(/\d{1,8}\s*(钻石|钻|抖币).*$/gu, "")
    .replace(/\s*(赠送|购买|解锁|已拥有|背包|限时|免费|可赠送).*$/gu, "")
    .replace(/[：:，,。.!！?？"'“”‘’]+$/gu, "")
    .trim();
}

function isLikelyGiftPanelName(value: string): boolean {
  const name = cleanGiftPanelName(value);
  const normalizedName = normalizeGiftName(name);
  if (!normalizedName || name.length > 24) return false;
  if (/^(礼物|背包|赠送|购买|充值|余额|搜索|全部|热门|粉丝团|特权|道具|装扮|活动)$/u.test(name)) return false;
  if (/直播间|抖币不足|去充值|查看|规则/u.test(name)) return false;
  return true;
}

function extractGiftPanelName(text: string): string | undefined {
  const lines = textLines(text);
  const priceLineIndex = lines.findIndex((line) => extractDiamondCounts(line).length > 0);
  const candidates =
    priceLineIndex > 0
      ? [...lines.slice(Math.max(0, priceLineIndex - 3), priceLineIndex).reverse(), ...lines]
      : lines;

  for (const candidate of candidates) {
    const name = cleanGiftPanelName(candidate);
    if (isLikelyGiftPanelName(name)) return name;
  }

  const name = cleanGiftPanelName(text);
  return isLikelyGiftPanelName(name) ? name : undefined;
}

function learnGiftFromPanelCandidate(candidate: HTMLElement): void {
  const text = normalizedText(candidate.innerText || candidate.textContent || "");
  if (text.length < 2 || text.length > 240) return;
  if (!/钻|抖币/u.test(text)) return;
  if (textLines(text).length > maxGiftPanelLearningLines) return;

  const diamondCounts = extractDiamondCounts(text);
  if (diamondCounts.length !== 1) return;

  const name = extractGiftPanelName(text);
  if (!name) return;
  const imageKeys = collectScopedGiftImageKeys(candidate);
  if (!imageKeys) return;

  learnGiftCatalogEntry({
    name,
    diamondCount: diamondCounts[0],
    imageKeys: imageKeys.length ? imageKeys : undefined,
    updatedAt: Date.now()
  });
}

let lastGiftPanelLearningAt = 0;

function learnVisibleGiftPanelEntries(): void {
  const now = Date.now();
  if (now - lastGiftPanelLearningAt < giftPanelLearningIntervalMs) return;
  lastGiftPanelLearningAt = now;

  Array.from(
    document.querySelectorAll<HTMLElement>(giftPanelCandidateSelector)
  )
    .slice(0, 800)
    .forEach(learnGiftFromPanelCandidate);
}

function learnGiftFromResolvedMatch(
  giftName: string | undefined,
  match: GiftCatalogMatch | null
): void {
  if (!match?.diamondCount) return;
  learnGiftCatalogEntry({
    name: match.name || giftName || "礼物",
    diamondCount: match.diamondCount,
    updatedAt: Date.now()
  });
}

function learnUnpricedGiftFromEvent(giftName: string | undefined, element?: HTMLElement): void {
  const name = normalizedText(giftName ?? "");
  if (!isLikelyGiftPanelName(name)) return;
  if (/^(礼物|未知礼物)$/u.test(name)) return;
  if (/^[a-z0-9]$/iu.test(name)) return;
  const imageKeys = element ? collectScopedGiftImageKeys(element) : null;

  learnGiftCatalogEntry({
    name,
    imageKeys: imageKeys?.length ? imageKeys : undefined,
    updatedAt: Date.now()
  });
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
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(giftPanelCandidateSelector)).slice(0, 600);

  for (const candidate of candidates) {
    const text = normalizedText(candidate.innerText || candidate.textContent || "");
    if (text.length < 2 || text.length > 180) continue;
    if (!/钻|抖币/u.test(text)) continue;
    if (textLines(text).length > maxGiftPanelLearningLines) continue;
    if (!collectScopedGiftImageKeys(candidate)) continue;
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
    learnGiftFromResolvedMatch(giftName, match);
    break;
  }

  pageGiftLookupCache.set(normalizedName, { expiresAt: now + 5000, match });
  return match;
}

function lookupGiftForEvent(giftName: string | undefined, element: HTMLElement | undefined): GiftCatalogMatch | null {
  const normalizedGiftName = normalizeGiftName(giftName);
  let namedMatch: GiftCatalogMatch | null | undefined;
  const getNamedMatch = () => {
    if (namedMatch !== undefined) return namedMatch;
    const catalogMatch = lookupGiftByName(giftName);
    namedMatch =
      catalogMatch?.confidence === "exact" ? catalogMatch : lookupVisiblePageGiftByName(giftName) ?? catalogMatch;
    return namedMatch;
  };
  let ambiguousImageMatch: GiftCatalogMatch | null = null;

  if (element) {
    for (const url of collectImageUrls(element)) {
      const match = lookupGiftByImageUrl(url);
      if (match) {
        if (match.confidence === "ambiguous") {
          ambiguousImageMatch ??= match;
          continue;
        }
        if (normalizedGiftName && normalizeGiftName(match.name) !== normalizedGiftName) {
          const exactNamedMatch = getNamedMatch();
          if (exactNamedMatch?.confidence === "exact") {
            learnGiftFromResolvedMatch(giftName, exactNamedMatch);
            return exactNamedMatch;
          }
        }
        learnGiftFromResolvedMatch(giftName, match);
        return match;
      }
    }
  }

  const match = getNamedMatch() ?? ambiguousImageMatch;
  learnGiftFromResolvedMatch(giftName, match);
  return match;
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
  if (!isLikelyExtractedGiftName(trimmedGiftName)) return false;
  if (/^[a-z0-9]$/iu.test(trimmedGiftName)) return false;
  if (match?.source === "catalog-name" && match.confidence === "ambiguous") return false;
  return true;
}

function makeGiftEvent(
  rawText: string,
  giftName: string,
  count: number | undefined,
  element?: HTMLElement,
  author?: Pick<LiveEvent, "userName" | "fanClubName">
): LiveEvent | null {
  const initialMatch = lookupGiftForEvent(giftName, element);
  const fallbackNameMatch = initialMatch?.diamondCount ? null : lookupGiftByName(giftName);
  const match = fallbackNameMatch?.diamondCount ? fallbackNameMatch : initialMatch;
  if (!hasStrongGiftEvidence(giftName, match)) return null;
  if (!match) learnUnpricedGiftFromEvent(giftName, element);

  const diamondCount = match?.diamondCount;
  const totalDiamondCount = typeof diamondCount === "number" ? diamondCount * (count ?? 1) : undefined;

  return makeEvent({
    type: "gift",
    ...(author ?? { userName: userNameFromSystemText(rawText) }),
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
  if (/抖音严禁未成年人直播|严禁违法违规|理性消费|谨防网络诈骗/u.test(rawText)) {
    return makeSystemEvent(rawText);
  }
  if (isSystemNoticeText(rawText)) return makeSystemEvent(rawText);

  const membershipAction = parseMembershipAction(rawText);
  if (membershipAction && hasMembershipColorEvidence(element)) {
    return makeMembershipEvent(
      rawText,
      membershipAction,
      parseActionAuthorFromText(text, rawText, isMembershipActionText)
    );
  }

  if (hasGiftActionText(rawText) && hasGiftVisualEvidence(element)) {
    const author = parseGiftAuthorFromText(text, rawText);
    const extractedGiftName = extractGiftName(text);
    const giftName = resolveGiftNameForEvent(extractedGiftName, element);
    if (!author && extractedGiftName === "礼物") return null;
    const giftEvent = makeGiftEvent(rawText, giftName, parseCount(rawText), element, author);
    if (giftEvent) return giftEvent;
  }

  if (hasStrongGiftActionText(rawText)) return null;

  if (textLines(text).some(isLikeActionText)) {
    return makeLikeEvent(rawText, parseActionAuthorFromText(text, rawText, isLikeActionText));
  }

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

  if (/点赞/u.test(rawText)) {
    return makeLikeEvent(rawText);
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
  if (content && isSystemNoticeText(content)) return makeSystemEvent(content);
  const membershipAction = content ? parseMembershipAction(content) : null;
  if (userName && content && membershipAction && hasMembershipColorEvidence(element, contentElement)) {
    return makeMembershipEvent(`${userName}: ${content}`, membershipAction, parseMemberAuthor(userName));
  }

  if (userName && content && hasGiftActionText(content) && hasGiftVisualEvidence(element, contentElement)) {
    const rawText = `${userName}: ${content}`;
    const giftScopeElement = contentElement ?? element;
    const giftName = resolveGiftNameForEvent(extractGiftName(content), giftScopeElement);
    const giftEvent = makeGiftEvent(rawText, giftName, parseCount(content), giftScopeElement, parseMemberAuthor(userName));
    if (giftEvent) return giftEvent;
  }

  if (userName && content && hasStrongGiftActionText(content)) return null;

  if (userName && content && isLikeActionText(content)) {
    return makeLikeEvent(`${userName}: ${content}`, parseMemberAuthor(userName));
  }

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

function isInsideInteractionFeed(element: HTMLElement): boolean {
  return Boolean(element.closest(interactionFeedSelector));
}

function shouldInspectInteractionElement(element: HTMLElement): boolean {
  if (element.closest("#douyin-moderator-web-root")) return false;
  if (element.closest(ignoredInteractionOverlaySelector) && !isInsideInteractionFeed(element)) return false;
  return isInsideInteractionFeed(element);
}

function isLikelyInteractionElement(element: HTMLElement): boolean {
  if (!shouldInspectInteractionElement(element)) return false;
  const text = normalizedText(element.innerText || element.textContent || "");
  if (text.length < 2 || text.length > 180) return false;
  return (
    hasGiftActionText(text) ||
    isMembershipActionText(text) ||
    /进入(了)?直播间|加入了直播间|进入(了)?房间|来了|来到直播间|关注(了)?主播|点赞|[：:]/u.test(text)
  );
}

function currentCommentUnavailableReason(): string | undefined {
  const pageText = normalizedText(document.body.innerText || document.body.textContent || "");
  if (/账号已在其他地方进入直播间|已退出直播间，?无法评论|无法评论/u.test(pageText)) {
    return "当前页面已退出直播间，抖音禁止评论，请先点「继续看播」恢复评论入口";
  }

  return undefined;
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
    isContentEditableInput(input)
  );
}

function isContentEditableInput(input: HTMLElement): boolean {
  const contentEditable = input.getAttribute("contenteditable");
  return input.isContentEditable || contentEditable === "true" || contentEditable === "plaintext-only";
}

function isVisibleElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && (rect.width > 0 || rect.height > 0);
}

function focusElement(element: Element): void {
  if (element instanceof HTMLElement) element.focus();
}

function normalizeReplyBoxText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function outgoingBarrageText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/[ \t]*[\r\n]+[ \t]*/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dispatchTextChanged(element: Element): void {
  try {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertReplacementText"
      })
    );
  } catch {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setTextControlValue(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (valueSetter) valueSetter.call(input, text);
  else input.value = text;
}

function fillTextControl(input: HTMLInputElement | HTMLTextAreaElement, text: string): boolean {
  if (isReadOnlyTextControl(input)) return false;
  setTextControlValue(input, text);
  return true;
}

function isReadOnlyTextControl(input: HTMLInputElement | HTMLTextAreaElement): boolean {
  return Boolean(
    input.disabled ||
      input.readOnly ||
      input.hasAttribute("readonly") ||
      input.getAttribute("aria-readonly") === "true"
  );
}

function readInputText(input: HTMLElement): string | undefined {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) return input.value;
  if (isContentEditableInput(input)) return logicalContentEditableText(input);
  return undefined;
}

function inputContainsText(input: HTMLElement, text: string): boolean {
  const currentText = readInputText(input);
  return currentText !== undefined && normalizeReplyBoxText(currentText) === normalizeReplyBoxText(text);
}

function inputDraftIsCleared(input: HTMLElement): boolean {
  const currentText = readInputText(input);
  return currentText !== undefined && normalizeReplyBoxText(currentText) === "";
}

function contentEditableText(input: HTMLElement): string {
  const maybeInnerText = (input as HTMLElement & { innerText?: unknown }).innerText;
  return typeof maybeInnerText === "string" ? maybeInnerText : input.textContent ?? "";
}

function logicalContentEditableText(input: HTMLElement): string {
  return stripLeadingChatInputPlaceholderText(input, contentEditableText(input));
}

function stripLeadingChatInputPlaceholderText(input: HTMLElement, value: string): string {
  const normalizedValue = normalizeReplyBoxText(value);
  if (!normalizedValue) return "";

  const placeholders = [...chatInputPlaceholderTexts(input), chatInputPlaceholderFallback]
    .map((placeholder) => normalizeReplyBoxText(placeholder))
    .filter(Boolean);

  for (const placeholder of placeholders) {
    if (normalizedValue === placeholder) return "";
    if (normalizedValue.startsWith(`${placeholder} `) || normalizedValue.startsWith(placeholder)) {
      return normalizedValue.slice(placeholder.length).trim();
    }
  }

  return value;
}

function chatInputPlaceholderTexts(input: HTMLElement): string[] {
  return [
    input.getAttribute("placeholder") ?? "",
    input.getAttribute("aria-placeholder") ?? "",
    input.getAttribute("data-placeholder") ?? ""
  ].filter(Boolean);
}

function setContentEditableText(input: HTMLElement, text: string): void {
  input.textContent = text;
}

interface ContentEditableInsertResult {
  inserted: boolean;
  inputObserved: boolean;
}

function insertContentEditableText(input: HTMLElement, text: string): ContentEditableInsertResult {
  const ownerDocument = input.ownerDocument;
  if (typeof ownerDocument.execCommand !== "function") return { inserted: false, inputObserved: false };

  const selection = ownerDocument.getSelection?.();
  const range = ownerDocument.createRange?.();
  if (selection && range) {
    try {
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Best effort: focused editors often still accept insertText.
    }
  }

  let inputObserved = false;
  const observeInput = (): void => {
    inputObserved = true;
  };
  input.addEventListener("input", observeInput, true);

  try {
    return {
      inserted: ownerDocument.execCommand("insertText", false, text),
      inputObserved
    };
  } catch {
    return { inserted: false, inputObserved: false };
  } finally {
    input.removeEventListener("input", observeInput, true);
  }
}

interface ContentEditableFillResult {
  filled: boolean;
  shouldDispatchTextChanged: boolean;
}

function fillContentEditable(input: HTMLElement, text: string): ContentEditableFillResult {
  const inserted = insertContentEditableText(input, text);
  const repaired = repairRepeatedContentEditableText(input, text);
  if (repaired.matched) {
    return {
      filled: true,
      shouldDispatchTextChanged: !inserted.inputObserved || repaired.changed
    };
  }

  if (inserted.inserted && contentEditableTextMatchesExpected(input, text)) {
    return {
      filled: true,
      shouldDispatchTextChanged: !inserted.inputObserved
    };
  }

  setContentEditableText(input, text);
  const fallbackRepaired = repairRepeatedContentEditableText(input, text);
  return {
    filled: contentEditableTextMatchesExpected(input, text) || fallbackRepaired.matched,
    shouldDispatchTextChanged: true
  };
}

interface ContentEditableRepairResult {
  matched: boolean;
  changed: boolean;
}

function repairRepeatedContentEditableText(input: HTMLElement, expectedText: string): ContentEditableRepairResult {
  const currentText = contentEditableText(input);
  const logicalText = logicalContentEditableText(input);
  if (contentEditableTextMatchesExpectedValue(currentText, expectedText)) {
    return { matched: true, changed: false };
  }

  if (
    contentEditableTextMatchesExpectedValue(logicalText, expectedText) ||
    isRepeatedExpectedText(currentText, expectedText) ||
    isDuplicatedLeadingExpectedBlock(currentText, expectedText) ||
    isRepeatedExpectedText(logicalText, expectedText) ||
    isDuplicatedLeadingExpectedBlock(logicalText, expectedText)
  ) {
    setContentEditableText(input, expectedText);
    return { matched: true, changed: true };
  }

  if (!isRepeatedExpectedText(currentText, expectedText) && !isDuplicatedLeadingExpectedBlock(currentText, expectedText)) {
    return { matched: false, changed: false };
  }

  setContentEditableText(input, expectedText);
  return { matched: true, changed: true };
}

function contentEditableTextMatchesExpected(input: HTMLElement, expectedText: string): boolean {
  return contentEditableTextMatchesExpectedValue(contentEditableText(input), expectedText);
}

function contentEditableTextMatchesExpectedValue(currentText: string, expectedText: string): boolean {
  return normalizeContentEditableDuplicateSegment(currentText) === normalizeContentEditableDuplicateSegment(expectedText);
}

function normalizeContentEditableDuplicateSegment(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B\u200C\u200D\uFEFF]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactContentEditableText(value: string): string {
  return value.replace(/\s+/g, "");
}

function isRepeatedExpectedText(currentText: string, expectedText: string): boolean {
  const expected = normalizeContentEditableDuplicateSegment(expectedText);
  if (!expected) return false;

  let repeatCount = 0;
  let remaining = normalizeContentEditableDuplicateSegment(currentText);
  while (remaining.startsWith(expected)) {
    repeatCount += 1;
    remaining = normalizeContentEditableDuplicateSegment(remaining.slice(expected.length));
  }

  return repeatCount > 1 && remaining.length === 0;
}

function isDuplicatedLeadingExpectedBlock(currentText: string, expectedText: string): boolean {
  const firstBlock = firstExpectedContentBlock(expectedText);
  if (!firstBlock) return false;

  const normalizedCurrent = normalizeContentEditableDuplicateSegment(currentText);
  const normalizedExpected = normalizeContentEditableDuplicateSegment(expectedText);
  const normalizedFirstBlock = normalizeContentEditableDuplicateSegment(firstBlock);
  const normalizedDuplicatedPrefix = normalizeContentEditableDuplicateSegment(`${firstBlock}\n${expectedText}`);
  const normalizedRemainder = stripLeadingContentEditableBlock(normalizedCurrent, normalizedFirstBlock);
  const compactCurrent = compactContentEditableText(normalizedCurrent);
  const compactExpected = compactContentEditableText(normalizedExpected);
  const compactFirstBlock = compactContentEditableText(normalizedFirstBlock);
  const compactRemainder =
    compactFirstBlock && compactCurrent.startsWith(compactFirstBlock)
      ? compactCurrent.slice(compactFirstBlock.length)
      : undefined;

  return (
    normalizedExpected !== normalizedDuplicatedPrefix &&
    (normalizedCurrent === normalizedDuplicatedPrefix ||
      compactContentEditableText(normalizedCurrent) === compactContentEditableText(normalizedDuplicatedPrefix) ||
      normalizedRemainder === normalizedExpected ||
      compactRemainder === compactExpected)
  );
}

function firstExpectedContentBlock(expectedText: string): string | undefined {
  const paragraph = expectedText
    .split(/\r?\n+/u)
    .map((part) => part.trim())
    .find(Boolean);
  if (paragraph && paragraph !== expectedText.trim()) return paragraph;
  return expectedText.match(/^.+?[。！？!?](?=\s|$)/u)?.[0]?.trim() || paragraph;
}

function stripLeadingContentEditableBlock(normalizedTextValue: string, normalizedBlock: string): string | undefined {
  if (!normalizedBlock || !normalizedTextValue.startsWith(normalizedBlock)) return undefined;
  return normalizeContentEditableDuplicateSegment(normalizedTextValue.slice(normalizedBlock.length));
}

async function stabilizeContentEditableText(input: HTMLElement, expectedText: string): Promise<boolean> {
  for (const delayMs of contentEditableStabilizationPollDelaysMs) {
    await sleep(delayMs);
    repairRepeatedContentEditableText(input, expectedText);
  }

  return contentEditableTextMatchesExpected(input, expectedText) || repairRepeatedContentEditableText(input, expectedText).matched;
}

function scheduleContentEditableDuplicateCleanup(input: HTMLElement, expectedText: string): void {
  for (const delayMs of contentEditablePostFillCleanupDelaysMs) {
    window.setTimeout(() => {
      const alreadyMatched = contentEditableTextMatchesExpected(input, expectedText);
      const repaired = repairRepeatedContentEditableText(input, expectedText);
      if (repaired.matched && repaired.changed && !alreadyMatched) dispatchTextChanged(input);
    }, delayMs);
  }
}

async function setInputText(input: HTMLElement, text: string): Promise<boolean> {
  focusElement(input);

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    if (!fillTextControl(input, text)) return false;
    dispatchTextChanged(input);
    return true;
  }

  if (!isContentEditableInput(input)) return false;
  if (!(await clearInputTextBeforeWrite(input))) return false;

  const result = fillContentEditable(input, text);
  if (!result.filled) return false;
  if (result.shouldDispatchTextChanged) dispatchTextChanged(input);

  const stabilized = await stabilizeContentEditableText(input, text);
  if (stabilized) scheduleContentEditableDuplicateCleanup(input, text);
  return stabilized;
}

function clearInputText(input: HTMLElement): void {
  focusElement(input);

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    setTextControlValue(input, "");
  } else if (isContentEditableInput(input)) {
    setContentEditableText(input, "");
  }

  dispatchTextChanged(input);
}

async function clearInputTextBeforeWrite(input: HTMLElement): Promise<boolean> {
  for (const delayMs of inputClearBeforeWritePollDelaysMs) {
    clearInputText(input);
    if (delayMs > 0) await sleep(delayMs);
    if (inputDraftIsCleared(input)) return true;
  }

  return inputDraftIsCleared(input);
}

function isUsableActionElement(element: HTMLElement): boolean {
  if (!isVisibleElement(element)) return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element.getAttribute("data-disabled") === "true") return false;
  if (element.hasAttribute("disabled")) return false;
  if (element.classList.contains("disabled") || element.classList.contains("is-disabled")) return false;
  return true;
}

function findNearbyIconSendButton(input: HTMLElement): HTMLElement | null {
  const inputRect = input.getBoundingClientRect();
  const candidates = new Map<HTMLElement, number>();

  for (const root of collectNearbySendSearchRoots(input)) {
    const elements = root.querySelectorAll<Element>(
      'button, [role="button"], [tabindex], [aria-label], [title], [data-e2e], svg, img, [class]'
    );

    for (const element of elements) {
      const actionElement = resolveNearbySendActionElement(element, input);
      if (!actionElement || candidates.has(actionElement)) continue;
      if (!isNearbySendButtonCandidate(actionElement, input, inputRect)) continue;
      candidates.set(actionElement, scoreNearbySendButtonCandidate(actionElement, inputRect));
    }
  }

  return Array.from(candidates.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function findHitTestSendButton(input: HTMLElement): ClickableElement | null {
  const inputRect = input.getBoundingClientRect();
  const inputCenterY = inputRect.top + inputRect.height / 2;
  const points = hitTestSendButtonPoints(input, inputRect);

  for (const point of points) {
    const elements = document.elementsFromPoint(point.x, point.y);
    for (const element of elements) {
      const actionElement = resolveHitTestSendActionElement(element, input);
      if (!actionElement) continue;
      if (isHitTestSendButtonCandidate(actionElement, input, inputRect, inputCenterY)) return actionElement;
    }
  }

  return null;
}

function hitTestSendButtonPoints(input: HTMLElement, inputRect: DOMRect): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const yValues = uniqueRoundedNumbers([
    inputRect.top + inputRect.height / 2,
    inputRect.top + Math.min(inputRect.height - 6, Math.max(6, inputRect.height * 0.5)),
    inputRect.bottom - 10
  ]);
  const xValues = uniqueRoundedNumbers([
    inputRect.right - 14,
    inputRect.right - 34,
    inputRect.right + 12,
    inputRect.right + 32,
    inputRect.right + 56,
    ...collectNearbySendSearchRoots(input).flatMap((root) => {
      const rect = root.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? [rect.right - 14, rect.right - 34, rect.right - 58] : [];
    })
  ]);

  for (const x of xValues.sort((left, right) => right - left)) {
    for (const y of yValues) {
      if (x > 0 && y > 0 && x < window.innerWidth && y < window.innerHeight) points.push({ x, y });
    }
  }

  return points;
}

function uniqueRoundedNumbers(values: number[]): number[] {
  return Array.from(new Set(values.map((value) => Math.round(value)).filter(Number.isFinite)));
}

function resolveHitTestSendActionElement(element: Element, input: HTMLElement): ClickableElement | null {
  let current: Element | null = element;

  for (let depth = 0; current && current !== document.body && depth < 5; depth += 1) {
    if (current === input || current.contains(input)) {
      current = current.parentElement;
      continue;
    }

    if (isClickableElement(current) && isCompactHitTestElement(current)) return current;
    current = current.parentElement;
  }

  return isClickableElement(element) ? element : null;
}

function isHitTestSendButtonCandidate(
  element: ClickableElement,
  input: HTMLElement,
  inputRect: DOMRect,
  inputCenterY: number
): boolean {
  if (element === input || element.contains(input) || input.contains(element)) return false;
  if (!isVisibleActionElement(element) || isDisabledActionElement(element)) return false;
  if (!isCompactHitTestElement(element)) return false;

  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  if (Math.abs(centerY - inputCenterY) > Math.max(nearbySendButtonMaxVerticalOffsetPx, inputRect.height * 1.75)) {
    return false;
  }
  if (centerX < inputRect.left + inputRect.width * 0.5 && rect.right < inputRect.right - 48) return false;
  if (rect.left > inputRect.right + nearbySendButtonMaxDistancePx) return false;
  if (rect.right < inputRect.left) return false;

  return !/表情|emoji|礼物|gift|点赞|like/i.test(actionElementText(element));
}

function isClickableElement(element: Element | null): element is ClickableElement {
  return element instanceof HTMLElement || (typeof SVGElement !== "undefined" && element instanceof SVGElement);
}

function isVisibleActionElement(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function isDisabledActionElement(element: Element): boolean {
  const maybeDisabled = element as Element & { disabled?: boolean };
  return Boolean(
    maybeDisabled.disabled ||
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.getAttribute("data-disabled") === "true" ||
      element.classList.contains("disabled") ||
      element.classList.contains("is-disabled")
  );
}

function isCompactHitTestElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width >= 8 &&
    rect.height >= 8 &&
    rect.width <= nearbySendButtonMaxSizePx &&
    rect.height <= nearbySendButtonMaxSizePx
  );
}

function collectNearbySendSearchRoots(input: HTMLElement): HTMLElement[] {
  const roots = new Set<HTMLElement>();
  const semanticRoot = input.closest<HTMLElement>(
    '[data-e2e*="chat" i], [class*="chat" i], [class*="comment" i], [class*="input" i]'
  );
  if (semanticRoot) roots.add(semanticRoot);

  let current = input.parentElement;
  for (let depth = 0; current && depth < 6; depth += 1) {
    roots.add(current);
    current = current.parentElement;
  }

  return Array.from(roots);
}

function resolveNearbySendActionElement(candidate: Element, input: HTMLElement): HTMLElement | null {
  let current = candidate instanceof HTMLElement ? candidate : candidate.parentElement;
  let fallback: HTMLElement | null = null;

  for (let depth = 0; current && current !== document.body && depth < 4; depth += 1) {
    if (current === input || current.contains(input)) break;

    if (isCompactActionElement(current)) fallback = current;
    if (isCompactActionElement(current) && isLikelyClickableElement(current)) return current;

    current = current.parentElement;
  }

  return fallback;
}

function isCompactActionElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width >= 8 &&
    rect.height >= 8 &&
    rect.width <= nearbySendButtonMaxSizePx &&
    rect.height <= nearbySendButtonMaxSizePx
  );
}

function isNearbySendButtonCandidate(element: HTMLElement, input: HTMLElement, inputRect: DOMRect): boolean {
  if (element === input || element.contains(input) || input.contains(element)) return false;
  if (!isUsableActionElement(element) || !isCompactActionElement(element)) return false;

  const rect = element.getBoundingClientRect();
  const inputCenterY = inputRect.top + inputRect.height / 2;
  const candidateCenterX = rect.left + rect.width / 2;
  const candidateCenterY = rect.top + rect.height / 2;
  const verticalDistance = Math.abs(candidateCenterY - inputCenterY);
  const rightSideThreshold = inputRect.left + inputRect.width * 0.6;

  if (verticalDistance > Math.max(nearbySendButtonMaxVerticalOffsetPx, inputRect.height * 1.75)) return false;
  if (candidateCenterX < rightSideThreshold && rect.left < inputRect.right - 36) return false;
  if (rect.left > inputRect.right + nearbySendButtonMaxDistancePx) return false;
  if (rect.right < inputRect.left) return false;

  return !/表情|emoji|礼物|gift|点赞|like/i.test(actionElementText(element));
}

function scoreNearbySendButtonCandidate(element: HTMLElement, inputRect: DOMRect): number {
  const rect = element.getBoundingClientRect();
  const label = actionElementText(element);
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const inputCenterY = inputRect.top + inputRect.height / 2;

  let score = centerX - Math.abs(centerY - inputCenterY) * 2;
  if (/发送|send/i.test(label)) score += 10000;
  if (isLikelyClickableElement(element)) score += 500;
  if (/^(IMG|SVG)$/u.test(element.tagName)) score += 100;
  return score;
}

function isLikelyClickableElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    element instanceof HTMLButtonElement ||
    element.getAttribute("role") === "button" ||
    element.tabIndex >= 0 ||
    style.cursor === "pointer" ||
    typeof element.onclick === "function" ||
    /button|send|submit|发送/i.test(actionElementText(element))
  );
}

function actionElementText(element: Element): string {
  const htmlElement = element instanceof HTMLElement ? element : undefined;
  return [
    htmlElement?.innerText,
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-e2e"),
    element.getAttribute("class")
  ]
    .filter(Boolean)
    .join(" ");
}

function clickElement(element: HTMLElement | SVGElement): void {
  const clickable = element as HTMLElement & { click?: () => void };
  if (typeof clickable.click === "function") {
    clickable.click();
    return;
  }

  element.dispatchEvent(clickEvent(element));
}

function clickEvent(element: Element): Event {
  const view = element.ownerDocument.defaultView;
  if (typeof view?.MouseEvent === "function") return new view.MouseEvent("click", { bubbles: true, cancelable: true });
  return new Event("click", { bubbles: true, cancelable: true });
}

function viewportPointFromElement(element: Element): ViewportPoint | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function fallbackSendPointFromInput(input: HTMLElement): ViewportPoint | null {
  const inputRect = input.getBoundingClientRect();
  if (inputRect.width <= 0 || inputRect.height <= 0) return null;

  const root = collectNearbySendSearchRoots(input)
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => right.right - left.right)[0];
  const x = Math.min(window.innerWidth - 8, Math.max(8, (root?.right ?? inputRect.right) - 22));
  const y = Math.min(window.innerHeight - 8, Math.max(8, inputRect.top + inputRect.height / 2));
  return { x, y };
}

function chromeRuntimeSendMessage<TResponse>(message: unknown): Promise<TResponse | undefined> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      resolve(undefined);
      return;
    }

    chrome.runtime.sendMessage(message, (response: TResponse | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

async function dispatchTrustedClick(point: ViewportPoint): Promise<TrustedClickResponse> {
  const response = await chromeRuntimeSendMessage<TrustedClickResponse>({
    type: "DMW_TRUSTED_CLICK",
    point
  });

  return response ?? { ok: false, error: "可信点击通道不可用" };
}

async function dispatchTrustedEnter(): Promise<TrustedClickResponse> {
  const response = await chromeRuntimeSendMessage<TrustedClickResponse>({
    type: "DMW_TRUSTED_ENTER"
  });

  return response ?? { ok: false, error: "可信回车通道不可用" };
}

async function clickSendControl(input: HTMLElement, button: ClickableElement | null): Promise<TrustedClickResponse> {
  const trustedPoint = button ? viewportPointFromElement(button) : fallbackSendPointFromInput(input);
  if (trustedPoint) {
    const trustedClick = await dispatchTrustedClick(trustedPoint);
    if (trustedClick.ok) return trustedClick;
    if (!button) return trustedClick;
  }

  if (!button) return { ok: false, error: "未找到可用发送按钮" };
  clickElement(button);
  return { ok: true };
}

function findSendButton(input: HTMLElement): ClickableElement | null {
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

  return findNearbyIconSendButton(input) ?? findHitTestSendButton(input);
}

async function waitForSendButton(input: HTMLElement): Promise<ClickableElement | null> {
  for (const delayMs of sendButtonPollDelaysMs) {
    if (delayMs > 0) await sleep(delayMs);
    const button = findSendButton(input);
    if (button) return button;
  }

  return null;
}

async function waitForSendCompletion(input: HTMLElement, expectedText: string): Promise<boolean> {
  const deadline = Date.now() + sendCompletionTimeoutMs;

  do {
    const currentInput = findChatInput() ?? input;
    if (!currentInput.isConnected || inputDraftIsCleared(currentInput)) return true;
    if (!inputContainsText(currentInput, expectedText) && normalizeReplyBoxText(readInputText(currentInput) ?? "") === "") {
      return true;
    }

    await sleep(sendCompletionPollMs);
  } while (Date.now() <= deadline);

  return false;
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
        const element = node instanceof HTMLElement ? node : node.parentElement;
        if (element && !shouldInspectInteractionElement(element)) return;
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
        learnVisibleGiftPanelEntries();
      });

      observer.observe(document.body, { childList: true, subtree: true });
      const seedExistingNodes = () => {
        Array.from(document.querySelectorAll<HTMLElement>("div, span, p, li"))
          .filter(isLikelyInteractionElement)
          .slice(-800)
          .forEach(inspectNode);
      };
      window.setTimeout(seedExistingNodes, 250);
      window.setTimeout(seedExistingNodes, 1200);
      window.setTimeout(learnVisibleGiftPanelEntries, 500);
      window.setTimeout(learnVisibleGiftPanelEntries, 2000);
      return () => observer.disconnect();
    },

    async sendBarrage(text, options): Promise<PageSendResult> {
      const unavailableReason = currentCommentUnavailableReason();
      if (unavailableReason) return { ok: false, error: unavailableReason };

      const input = findChatInput();
      if (!input) return { ok: false, error: "未找到弹幕输入框" };

      const outgoingText = outgoingBarrageText(text);
      if (!outgoingText) return { ok: false, error: "弹幕内容为空" };

      const verifyInputWrite = options?.verifyInputWrite ?? true;
      const filled = await setInputText(input, outgoingText);
      if (verifyInputWrite && !filled) return { ok: false, error: "弹幕输入框写入失败" };

      if (verifyInputWrite && !inputContainsText(input, outgoingText)) {
        return { ok: false, error: "弹幕输入框写入失败" };
      }

      const enterResult = await dispatchTrustedEnter();
      if (enterResult.ok) {
        const completed = await waitForSendCompletion(input, outgoingText);
        if (completed) return { ok: true };
        clearInputText(findChatInput() ?? input);
        return { ok: false, error: "回车发送后未确认输入框清空，已清空草稿" };
      }

      const button = await waitForSendButton(input);
      if (!button && !fallbackSendPointFromInput(input)) {
        clearInputText(input);
        return { ok: false, error: `${enterResult.error ?? "可信回车通道不可用"}；未找到可用发送按钮，已清空草稿` };
      }

      const clickResult = await clickSendControl(input, button);
      if (!clickResult.ok) {
        return { ok: false, error: clickResult.error ?? "发送按钮点击失败" };
      }

      const completed = await waitForSendCompletion(input, outgoingText);
      if (!completed) return { ok: false, error: "发送后未确认输入框清空" };

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
