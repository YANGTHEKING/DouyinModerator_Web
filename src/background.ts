import {
  cleanAiTimedBarrageText,
  createAiTimedBarrageMessages,
  type AiTimedBarrageStyleId
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

interface ActiveClickBurst {
  cancelled: boolean;
}

const activeClickBursts = new Map<number, ActiveClickBurst>();
const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
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
  const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${decodeDeepSeekApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: createAiTimedBarrageMessages({
        styleId: message.styleId,
        mode: message.mode,
        examples: message.examples,
        maxLength
      }),
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
