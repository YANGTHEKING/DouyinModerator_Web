export {};

interface ViewportPoint {
  x: number;
  y: number;
}

interface TrustedClickMessage {
  type: "DMW_TRUSTED_CLICK";
  point: ViewportPoint;
}

interface TrustedEnterMessage {
  type: "DMW_TRUSTED_ENTER";
}

interface TrustedClickResponse {
  ok: boolean;
  error?: string;
}

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

function isTrustedEnterMessage(value: unknown): value is TrustedEnterMessage {
  if (!value || typeof value !== "object") return false;
  return (value as Partial<TrustedEnterMessage>).type === "DMW_TRUSTED_ENTER";
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
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: message.point.x,
      y: message.point.y,
      button: "none"
    });
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: message.point.x,
      y: message.point.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: message.point.x,
      y: message.point.y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
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
