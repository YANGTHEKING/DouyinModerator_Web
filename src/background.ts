import {
  cleanAiTimedBarrageText,
  createAiTimedBarrageMessages,
  shouldUseAiTimedBarrageWebSearch,
  type AiTimedBarragePromptInput,
  type AiTimedBarrageIntentId,
  type AiTimedBarrageStyleId,
  type AiTimedBarrageTopicCategoryId,
  type AiTimedBarrageTopicFreshnessId,
  type AiTimedBarrageTopicTargetId
} from "./domain/aiTimedBarrage";
import type { TimedBarrageMode } from "./domain/types";

export {};

interface ViewportPoint {
  x: number;
  y: number;
}

interface TrustedClickMessage {
  type: "DMW_TRUSTED_CLICK";
  point: ViewportPoint;
}

interface TrustedClickBurstMessage {
  type: "DMW_TRUSTED_CLICK_BURST";
  point: ViewportPoint;
  durationMs: number;
  clickGapMs: number;
  pairGapMs: number;
}

interface TrustedClickBurstCancelMessage {
  type: "DMW_CANCEL_TRUSTED_CLICK_BURST";
}

interface TrustedEnterMessage {
  type: "DMW_TRUSTED_ENTER";
}

interface GenerateTimedBarrageMessage {
  type: "DMW_GENERATE_TIMED_BARRAGE";
  styleId: AiTimedBarrageStyleId;
  intentId?: AiTimedBarrageIntentId;
  topicTargetId?: AiTimedBarrageTopicTargetId;
  topicCategoryId?: AiTimedBarrageTopicCategoryId;
  topicFreshnessId?: AiTimedBarrageTopicFreshnessId;
  mode: TimedBarrageMode;
  examples: string[];
  maxLength: number;
}

interface TrustedClickResponse {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
}

interface GenerateTimedBarrageResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

interface DeepSeekAnthropicContentBlock {
  type?: string;
  text?: string | null;
  content?: unknown;
  [key: string]: unknown;
}

interface DeepSeekAnthropicMessage {
  role: "user" | "assistant";
  content: string | DeepSeekAnthropicContentBlock[];
}

interface DeepSeekAnthropicResponse {
  content?: DeepSeekAnthropicContentBlock[];
  stop_reason?: string;
}

interface ActiveClickBurst {
  cancelled: boolean;
}

const activeClickBursts = new Map<number, ActiveClickBurst>();
const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_ANTHROPIC_MESSAGES_URL = "https://api.deepseek.com/anthropic/v1/messages";
const DEEPSEEK_TIMED_BARRAGE_MODEL = "deepseek-v4-flash";
const DEEPSEEK_WEB_SEARCH_MAX_TOKENS = 1200;
const DEEPSEEK_WEB_SEARCH_MAX_CONTINUATIONS = 2;
const DEEPSEEK_API_KEY_BYTES = [
  40, 17, 180, 143, 238, 192, 39, 7, 48, 19, 169, 211, 170, 140, 57, 24, 123, 95, 191, 144, 165, 212,
  97, 20, 117, 3, 183, 151, 218, 230, 206, 36, 9, 107, 65
] as const;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isTrustedClickMessage(message)) {
    void dispatchTrustedClick(message, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "可信点击发送失败"
        } satisfies TrustedClickResponse);
      });

    return true;
  }

  if (isTrustedClickBurstMessage(message)) {
    void dispatchTrustedClickBurst(message, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "可信连点发送失败"
        } satisfies TrustedClickResponse);
      });

    return true;
  }

  if (isTrustedClickBurstCancelMessage(message)) {
    sendResponse(cancelTrustedClickBurst(sender));
    return false;
  }

  if (isTrustedEnterMessage(message)) {
    void dispatchTrustedEnter(sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "可信回车发送失败"
        } satisfies TrustedClickResponse);
      });

    return true;
  }

  if (isGenerateTimedBarrageMessage(message)) {
    void generateTimedBarrage(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "AI 弹幕生成失败"
        } satisfies GenerateTimedBarrageResponse);
      });

    return true;
  }

  return false;
});

function isTrustedClickMessage(value: unknown): value is TrustedClickMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TrustedClickMessage>;
  return (
    record.type === "DMW_TRUSTED_CLICK" &&
    typeof record.point?.x === "number" &&
    typeof record.point?.y === "number"
  );
}

function isTrustedClickBurstMessage(value: unknown): value is TrustedClickBurstMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TrustedClickBurstMessage>;
  return (
    record.type === "DMW_TRUSTED_CLICK_BURST" &&
    typeof record.point?.x === "number" &&
    typeof record.point?.y === "number" &&
    typeof record.durationMs === "number" &&
    typeof record.clickGapMs === "number" &&
    typeof record.pairGapMs === "number"
  );
}

function isTrustedClickBurstCancelMessage(value: unknown): value is TrustedClickBurstCancelMessage {
  if (!value || typeof value !== "object") return false;
  return (value as Partial<TrustedClickBurstCancelMessage>).type === "DMW_CANCEL_TRUSTED_CLICK_BURST";
}

function isTrustedEnterMessage(value: unknown): value is TrustedEnterMessage {
  if (!value || typeof value !== "object") return false;
  return (value as Partial<TrustedEnterMessage>).type === "DMW_TRUSTED_ENTER";
}

function isGenerateTimedBarrageMessage(value: unknown): value is GenerateTimedBarrageMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GenerateTimedBarrageMessage>;
  return (
    record.type === "DMW_GENERATE_TIMED_BARRAGE" &&
    typeof record.styleId === "string" &&
    (record.intentId === undefined || typeof record.intentId === "string") &&
    (record.topicTargetId === undefined || typeof record.topicTargetId === "string") &&
    (record.topicCategoryId === undefined || typeof record.topicCategoryId === "string") &&
    (record.topicFreshnessId === undefined || typeof record.topicFreshnessId === "string") &&
    (record.mode === "random" || record.mode === "sequential") &&
    Array.isArray(record.examples) &&
    typeof record.maxLength === "number"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

async function dispatchTrustedClick(
  message: TrustedClickMessage,
  sender: chrome.runtime.MessageSender
): Promise<TrustedClickResponse> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { ok: false, error: "无法定位当前直播页标签" };

  const target: chrome.debugger.Debuggee = { tabId };
  try {
    await attachDebugger(target);
    await moveMouse(target, message.point);
    await sendMouseClick(target, message.point, 1);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "可信点击发送失败"
    };
  } finally {
    await detachDebugger(target).catch(() => undefined);
  }
}

function cancelTrustedClickBurst(sender: chrome.runtime.MessageSender): TrustedClickResponse {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { ok: false, error: "无法定位当前直播页标签" };

  const activeBurst = activeClickBursts.get(tabId);
  if (activeBurst) activeBurst.cancelled = true;
  return { ok: true };
}

function decodeDeepSeekApiKey(): string {
  return DEEPSEEK_API_KEY_BYTES.map((value, index) =>
    String.fromCharCode(value ^ ((index * 31 + 91) & 255))
  ).join("");
}

async function generateTimedBarrage(message: GenerateTimedBarrageMessage): Promise<GenerateTimedBarrageResponse> {
  const maxLength = Math.min(80, Math.max(8, Math.round(message.maxLength || 60)));
  if (shouldUseAiTimedBarrageWebSearch(message)) {
    return generateTimedBarrageWithWebSearch(message, maxLength);
  }

  return generateTimedBarrageWithChatCompletion(message, maxLength);
}

function createTimedBarragePromptInput(
  message: GenerateTimedBarrageMessage,
  maxLength: number,
  webSearchRequired = false
): AiTimedBarragePromptInput {
  return {
    styleId: message.styleId,
    intentId: message.intentId,
    topicTargetId: message.topicTargetId,
    topicCategoryId: message.topicCategoryId,
    topicFreshnessId: message.topicFreshnessId,
    mode: message.mode,
    examples: message.examples,
    maxLength,
    webSearchRequired
  };
}

async function generateTimedBarrageWithChatCompletion(
  message: GenerateTimedBarrageMessage,
  maxLength: number
): Promise<GenerateTimedBarrageResponse> {
  const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${decodeDeepSeekApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEEPSEEK_TIMED_BARRAGE_MODEL,
      messages: createAiTimedBarrageMessages(createTimedBarragePromptInput(message, maxLength)),
      thinking: { type: "disabled" },
      temperature: 0.9,
      max_tokens: 80,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { ok: false, error: `DeepSeek 请求失败：${response.status}${errorText ? ` ${errorText.slice(0, 120)}` : ""}` };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = cleanAiTimedBarrageText(data.choices?.[0]?.message?.content, maxLength);
  if (!text) return { ok: false, error: "DeepSeek 未返回可用弹幕" };
  return { ok: true, text };
}

async function generateTimedBarrageWithWebSearch(
  message: GenerateTimedBarrageMessage,
  maxLength: number
): Promise<GenerateTimedBarrageResponse> {
  const promptMessages = createAiTimedBarrageMessages(createTimedBarragePromptInput(message, maxLength, true));
  const systemContent = promptMessages.find((item) => item.role === "system")?.content ?? "";
  const userContent = promptMessages
    .filter((item) => item.role === "user")
    .map((item) => item.content)
    .join("\n\n");
  const messages: DeepSeekAnthropicMessage[] = [
    {
      role: "user",
      content: `${userContent}\n\n请先调用 web_search 搜索，再只输出最终弹幕。`
    }
  ];

  const firstResponse = await requestDeepSeekAnthropicMessage(systemContent, messages, true);
  if (!firstResponse.ok) return firstResponse.errorResponse;

  let data = firstResponse.data;
  for (let index = 0; data.stop_reason === "pause_turn" && index < DEEPSEEK_WEB_SEARCH_MAX_CONTINUATIONS; index += 1) {
    if (!data.content?.length) break;
    messages.push({ role: "assistant", content: data.content });
    const continuation = await requestDeepSeekAnthropicMessage(systemContent, messages, false);
    if (!continuation.ok) return continuation.errorResponse;
    data = continuation.data;
  }

  const text = cleanAiTimedBarrageText(extractAnthropicFinalText(data.content), maxLength);
  if (text) return { ok: true, text };

  const searchContext = extractWebSearchResultContext(data.content);
  if (searchContext) {
    return generateTimedBarrageFromWebSearchContext(message, maxLength, searchContext);
  }

  return {
    ok: false,
    error: `DeepSeek Web Search 未返回可用弹幕${data.stop_reason ? `（stop_reason: ${data.stop_reason}）` : ""}`
  };
}

async function requestDeepSeekAnthropicMessage(
  systemContent: string,
  messages: DeepSeekAnthropicMessage[],
  forceWebSearch: boolean
): Promise<{ ok: true; data: DeepSeekAnthropicResponse } | { ok: false; errorResponse: GenerateTimedBarrageResponse }> {
  const response = await fetch(DEEPSEEK_ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": decodeDeepSeekApiKey(),
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEEPSEEK_TIMED_BARRAGE_MODEL,
      max_tokens: DEEPSEEK_WEB_SEARCH_MAX_TOKENS,
      system: systemContent,
      messages,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
          user_location: {
            type: "approximate",
            country: "CN",
            timezone: "Asia/Shanghai"
          }
        }
      ],
      ...(forceWebSearch ? { tool_choice: { type: "tool", name: "web_search" } } : {}),
      temperature: 0.9,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      ok: false,
      errorResponse: {
        ok: false,
        error: `DeepSeek Web Search 请求失败：${response.status}${errorText ? ` ${errorText.slice(0, 120)}` : ""}`
      }
    };
  }

  return { ok: true, data: (await response.json()) as DeepSeekAnthropicResponse };
}

async function generateTimedBarrageFromWebSearchContext(
  message: GenerateTimedBarrageMessage,
  maxLength: number,
  searchContext: string
): Promise<GenerateTimedBarrageResponse> {
  const messages = createAiTimedBarrageMessages(createTimedBarragePromptInput(message, maxLength, true));
  const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${decodeDeepSeekApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEEPSEEK_TIMED_BARRAGE_MODEL,
      messages: [
        messages[0],
        {
          role: "user",
          content: `${messages[1]?.content ?? ""}\n\nDeepSeek Web Search 搜索结果摘要：\n${searchContext}\n\n请只基于这些搜索结果收口成一句直播弹幕。`
        }
      ],
      thinking: { type: "disabled" },
      temperature: 0.85,
      max_tokens: 100,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      ok: false,
      error: `DeepSeek 搜索结果收口失败：${response.status}${errorText ? ` ${errorText.slice(0, 120)}` : ""}`
    };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = cleanAiTimedBarrageText(data.choices?.[0]?.message?.content, maxLength);
  if (!text) return { ok: false, error: "DeepSeek 搜索结果收口未返回可用弹幕" };
  return { ok: true, text };
}

function extractAnthropicFinalText(blocks: DeepSeekAnthropicContentBlock[] | undefined): string {
  const allTexts: string[] = [];
  const postSearchTexts: string[] = [];
  let hasSearchResult = false;

  for (const block of blocks ?? []) {
    if (block.type === "web_search_tool_result") hasSearchResult = true;
    if (block.type !== "text" || typeof block.text !== "string") continue;

    const text = block.text.trim();
    if (!text) continue;
    allTexts.push(text);
    if (hasSearchResult) postSearchTexts.push(text);
  }

  return (postSearchTexts.length ? postSearchTexts : allTexts).join(" ");
}

function extractWebSearchResultContext(blocks: DeepSeekAnthropicContentBlock[] | undefined): string {
  const lines: string[] = [];
  for (const block of blocks ?? []) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;

    for (const item of block.content) {
      if (!isRecord(item)) continue;
      const title = readStringField(item, "title");
      if (!title) continue;
      const pageAge = readStringField(item, "page_age");
      const url = readStringField(item, "url");
      lines.push(`${lines.length + 1}. ${title}${pageAge ? `（${pageAge}）` : ""}${url ? ` ${url}` : ""}`);
      if (lines.length >= 8) return lines.join("\n");
    }
  }

  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function dispatchTrustedClickBurst(
  message: TrustedClickBurstMessage,
  sender: chrome.runtime.MessageSender
): Promise<TrustedClickResponse> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { ok: false, error: "无法定位当前直播页标签" };

  const target: chrome.debugger.Debuggee = { tabId };
  const durationMs = clampNumber(message.durationMs, 100, 400000);
  const clickGapMs = clampNumber(message.clickGapMs, 20, 250);
  const pairGapMs = clampNumber(message.pairGapMs, 40, 1000);
  const previousBurst = activeClickBursts.get(tabId);
  if (previousBurst) previousBurst.cancelled = true;
  const activeBurst: ActiveClickBurst = { cancelled: false };
  activeClickBursts.set(tabId, activeBurst);

  try {
    await attachDebugger(target);
    await moveMouse(target, message.point);

    const deadline = Date.now() + durationMs;
    while (!activeBurst.cancelled && Date.now() <= deadline) {
      await sendMouseClick(target, message.point, 1);
      if (activeBurst.cancelled || Date.now() >= deadline) break;
      await sleep(clickGapMs);

      if (activeBurst.cancelled) break;
      await sendMouseClick(target, message.point, 2);
      if (activeBurst.cancelled || Date.now() >= deadline) break;
      await sleep(pairGapMs);
    }

    if (activeBurst.cancelled) return { ok: false, cancelled: true, error: "自动点赞已取消" };
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "可信连点发送失败"
    };
  } finally {
    if (activeClickBursts.get(tabId) === activeBurst) activeClickBursts.delete(tabId);
    await detachDebugger(target).catch(() => undefined);
  }
}

async function dispatchTrustedEnter(sender: chrome.runtime.MessageSender): Promise<TrustedClickResponse> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { ok: false, error: "无法定位当前直播页标签" };

  const target: chrome.debugger.Debuggee = { tabId };
  try {
    await attachDebugger(target);
    await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 36
    });
    await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 36
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "可信回车发送失败"
    };
  } finally {
    await detachDebugger(target).catch(() => undefined);
  }
}

function moveMouse(target: chrome.debugger.Debuggee, point: ViewportPoint): Promise<void> {
  return sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none"
  });
}

async function sendMouseClick(target: chrome.debugger.Debuggee, point: ViewportPoint, clickCount: number): Promise<void> {
  await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount
  });
  await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount
  });
}

function attachDebugger(target: chrome.debugger.Debuggee): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      const message = chrome.runtime.lastError?.message;
      if (message) reject(new Error(message));
      else resolve();
    });
  });
}

function detachDebugger(target: chrome.debugger.Debuggee): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      const message = chrome.runtime.lastError?.message;
      if (message) reject(new Error(message));
      else resolve();
    });
  });
}

function sendDebuggerCommand(
  target: chrome.debugger.Debuggee,
  method: string,
  commandParams?: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, commandParams, () => {
      const message = chrome.runtime.lastError?.message;
      if (message) reject(new Error(message));
      else resolve();
    });
  });
}
