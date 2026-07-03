import { createDefaultProfile } from "../domain/defaultProfile";
import { createDefaultGiftReplyTiers, normalizeGiftReplyTiers } from "../domain/giftReplyTiers";
import type {
  AssistantProfile,
  AutomationRule,
  ScheduledAction,
  TimedBarrageItem,
  TimedBarrageMode,
  TimedBarragePool
} from "../domain/types";

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
    const trigger = source.trigger || "chatKeyword";
    const giftReplyTiers =
      trigger === "gift" || trigger === "specificGift"
        ? normalizeGiftReplyTiers(source.giftReplyTiers) ?? createDefaultGiftReplyTiers()
        : undefined;

    return {
      id: String(source.id || `rule_imported_${index}`),
      name: String(source.name || "未命名规则"),
      trigger,
      matchPattern: String(source.matchPattern || "*"),
      replyTemplate: String(source.replyTemplate || ""),
      giftReplyTiers,
      cooldownSeconds: clampNumber(source.cooldownSeconds, 10, 0, 3600),
      minGiftDiamondCount: clampNumber(source.minGiftDiamondCount, 0, 0, 100000000),
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

    return [];
  });
}

function normalizeTimedBarrageItems(value: unknown): TimedBarrageItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const source = item as Partial<TimedBarrageItem>;
    return {
      id: String(source.id || `timed_barrage_imported_${index}`),
      label: String(source.label || "定时弹幕"),
      text: String(source.text || ""),
      enabled: Boolean(source.enabled)
    };
  });
}

function legacyTimedBarrageItems(value: unknown): TimedBarrageItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((action, index): TimedBarrageItem[] => {
    const source = action as Partial<ScheduledAction>;
    if (source.kind !== "barrage") return [];
    return [
      {
        id: String(source.id || `timed_barrage_legacy_${index}`),
        label: String(source.label || "定时弹幕"),
        text: String((source as { text?: unknown }).text || ""),
        enabled: Boolean(source.enabled)
      }
    ];
  });
}

function legacyTimedBarrageInterval(value: unknown, fallback: number): number {
  if (!Array.isArray(value)) return fallback;
  const firstBarrage = value.find((action) => (action as Partial<ScheduledAction>).kind === "barrage") as
    | Partial<ScheduledAction>
    | undefined;
  return clampNumber(firstBarrage?.intervalSeconds, fallback, 30, 86400);
}

function normalizeTimedBarrageMode(value: unknown, fallback: TimedBarrageMode): TimedBarrageMode {
  return value === "random" || value === "sequential" ? value : fallback;
}

function appendMissingXiaoguangFunItems(items: TimedBarrageItem[], fallback: TimedBarragePool): TimedBarrageItem[] {
  const existingIds = new Set(items.map((item) => item.id));
  const missingItems = fallback.items.filter(
    (item) => item.id.startsWith("timed_barrage_xiaoguang_fun_") && !existingIds.has(item.id)
  );
  return missingItems.length ? [...items, ...missingItems] : items;
}

function normalizeTimedBarragePool(
  value: unknown,
  legacyScheduledActions: unknown,
  fallback: TimedBarragePool
): TimedBarragePool {
  const source = (value ?? {}) as Partial<TimedBarragePool>;
  const hasExplicitPool = Boolean(value && typeof value === "object");
  const explicitItems = normalizeTimedBarrageItems(source.items);
  const legacyItems = legacyTimedBarrageItems(legacyScheduledActions);

  const items = hasExplicitPool ? explicitItems : legacyItems.length ? legacyItems : fallback.items;

  return {
    enabled: hasExplicitPool ? Boolean(source.enabled) : legacyItems.some((item) => item.enabled),
    intervalSeconds: hasExplicitPool
      ? clampNumber(source.intervalSeconds, fallback.intervalSeconds, 30, 86400)
      : legacyTimedBarrageInterval(legacyScheduledActions, fallback.intervalSeconds),
    mode: normalizeTimedBarrageMode(source.mode, fallback.mode),
    items: appendMissingXiaoguangFunItems(items, fallback)
  };
}

export function normalizeProfile(value: unknown): AssistantProfile {
  const fallback = createDefaultProfile();
  const source = (value ?? {}) as Partial<AssistantProfile>;

  return {
    schemaVersion: 1,
    rules: normalizeRules(source.rules, fallback.rules),
    timedBarragePool: normalizeTimedBarragePool(
      source.timedBarragePool,
      source.scheduledActions,
      fallback.timedBarragePool
    ),
    scheduledActions: normalizeScheduledActions(source.scheduledActions, fallback.scheduledActions),
    globalSendIntervalSeconds: clampNumber(source.globalSendIntervalSeconds, 5, 5, 300),
    maxReplyLength: clampNumber(source.maxReplyLength, 80, 1, 200),
    verifyBarrageInputBeforeSend:
      typeof source.verifyBarrageInputBeforeSend === "boolean"
        ? source.verifyBarrageInputBeforeSend
        : fallback.verifyBarrageInputBeforeSend,
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
