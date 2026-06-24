import { createDefaultProfile } from "../domain/defaultProfile";
import type { AssistantProfile, AutomationRule, ScheduledAction } from "../domain/types";

const STORAGE_KEY = "assistantProfileV1";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function normalizeRules(value: unknown, fallback: AutomationRule[]): AutomationRule[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((rule, index) => {
    const source = rule as Partial<AutomationRule>;
    return {
      id: String(source.id || `rule_imported_${index}`),
      name: String(source.name || "未命名规则"),
      trigger: source.trigger || "chatKeyword",
      matchPattern: String(source.matchPattern || "*"),
      replyTemplate: String(source.replyTemplate || ""),
      cooldownSeconds: clampNumber(source.cooldownSeconds, 10, 0, 3600),
      enabled: Boolean(source.enabled)
    };
  });
}

function normalizeScheduledActions(value: unknown, fallback: ScheduledAction[]): ScheduledAction[] {
  if (!Array.isArray(value)) return fallback;
  return value.flatMap((action, index): ScheduledAction[] => {
    const source = action as Partial<ScheduledAction>;
    const base = {
      id: String(source.id || `scheduled_imported_${index}`),
      label: String(source.label || "定时动作"),
      intervalSeconds: clampNumber(source.intervalSeconds, 120, 30, 86400),
      enabled: Boolean(source.enabled)
    };

    if (source.kind === "like") {
      return [{ ...base, kind: "like", intervalSeconds: clampNumber(source.intervalSeconds, 30, 30, 86400) }];
    }

    if (source.kind === "barrage") {
      return [{ ...base, kind: "barrage", text: String(source.text || "") }];
    }

    return [];
  });
}

export function normalizeProfile(value: unknown): AssistantProfile {
  const fallback = createDefaultProfile();
  const source = (value ?? {}) as Partial<AssistantProfile>;

  return {
    schemaVersion: 1,
    rules: normalizeRules(source.rules, fallback.rules),
    scheduledActions: normalizeScheduledActions(source.scheduledActions, fallback.scheduledActions),
    globalSendIntervalSeconds: clampNumber(source.globalSendIntervalSeconds, 5, 5, 300),
    maxReplyLength: clampNumber(source.maxReplyLength, 80, 1, 200),
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now()
  };
}

export async function loadProfile(): Promise<AssistantProfile> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) return normalizeProfile(result[STORAGE_KEY]);
    const profile = createDefaultProfile();
    await saveProfile(profile);
    return profile;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createDefaultProfile();

  try {
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return createDefaultProfile();
  }
}

export async function saveProfile(profile: AssistantProfile): Promise<void> {
  const nextProfile = { ...profile, updatedAt: Date.now() };
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: nextProfile });
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProfile));
}
