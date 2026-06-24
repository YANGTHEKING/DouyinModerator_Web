export interface SendGuardInput {
  text: string;
  maxLength: number;
  lastSentText?: string;
  allowRepeat?: boolean;
}

export interface SendGuardResult {
  ok: boolean;
  text: string;
  reason?: string;
}

export function checkSendGuard(input: SendGuardInput): SendGuardResult {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) {
    return { ok: false, text, reason: "弹幕内容为空" };
  }
  if (text.length > input.maxLength) {
    return { ok: false, text, reason: `弹幕超过 ${input.maxLength} 字` };
  }
  if (!input.allowRepeat && input.lastSentText && text === input.lastSentText.trim()) {
    return { ok: false, text, reason: "连续重复弹幕已拦截" };
  }
  return { ok: true, text };
}
