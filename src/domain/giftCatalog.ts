import { GIFT_CATALOG_ENTRIES, type GiftCatalogEntry as GeneratedGiftCatalogEntry } from "../data/giftCatalog.generated";
import { GIFT_CATALOG_WEB_ENTRIES } from "../data/giftCatalog.web";
import type { GiftValueSource } from "./types";

type GiftCatalogEntry = GeneratedGiftCatalogEntry;
type PricedGiftCatalogEntry = (GiftCatalogEntry | LearnedGiftCatalogEntry) & { diamondCount: number };

export interface LearnedGiftCatalogEntry {
  name: string;
  diamondCount?: number;
  ids?: readonly number[];
  imageKeys?: readonly string[];
  updatedAt: number;
}

export interface GiftCatalogMatch {
  name: string;
  diamondCount?: number;
  diamondCountOptions?: number[];
  source: GiftValueSource;
  confidence: "exact" | "ambiguous";
}

const IMAGE_KEY_PATTERN = /[a-f0-9]{32}/iu;

export function normalizeGiftName(value: string | undefined): string {
  return (value ?? "")
    .replace(/\s+/gu, "")
    .replace(/[：:，,。.!！?？"'“”‘’·・•]/gu, "")
    .trim()
    .toLowerCase();
}

export function extractGiftImageKey(value: string | null | undefined): string | null {
  const match = value?.match(IMAGE_KEY_PATTERN);
  return match?.[0]?.toLowerCase() ?? null;
}

const manualGiftDiamondOverrides = new Map<string, number>([
  [normalizeGiftName("为你点亮"), 1],
  [normalizeGiftName("小心心"), 1],
  [normalizeGiftName("为你闪耀"), 9]
]);
const MAX_LEARNED_IMAGE_KEYS_WITHOUT_CATALOG_MATCH = 3;
const pollutedLearnedGiftNamePattern = /达标|可获|礼信息|这么多|姐姐|哥哥|直播间|房管助手|发送队列/u;
const emojiPattern = /\p{Extended_Pictographic}/u;
const pendingLearnedGiftNameHintPattern =
  /礼物|礼|花|心|星|月|云|灯|牌|卡|票|包|箱|兔|车|飞机|飞艇|火箭|船|艇|皇冠|糖|酒|罐头|玫瑰|吻|抱|烟花|气球|嘉年华|丘比特|魔法|舞台|城堡|宝|钻/u;

function getManualGiftDiamondOverride(normalizedName: string): number | undefined {
  const exactOverride = manualGiftDiamondOverrides.get(normalizedName);
  if (exactOverride !== undefined) return exactOverride;
  if (/粉丝团.*灯牌/u.test(normalizedName) || /灯牌$/u.test(normalizedName)) return 1;
  return undefined;
}

function hasCatalogGiftName(normalizedName: string): boolean {
  return Boolean(webEntriesByName.get(normalizedName)?.length || entriesByName.get(normalizedName)?.length);
}

function isLikelyLearnedGiftName(
  name: string,
  normalizedName: string,
  diamondCount: number | undefined
): boolean {
  if (!normalizedName) return false;
  if (getManualGiftDiamondOverride(normalizedName) !== undefined || hasCatalogGiftName(normalizedName)) return true;
  if (normalizedName.length < 2 || name.length > 24) return false;
  if (/^\d+$/u.test(normalizedName)) return false;
  if (/^(礼物|未知礼物|系统|用户)$/u.test(name)) return false;
  if (pollutedLearnedGiftNamePattern.test(name)) return false;
  if (emojiPattern.test(name)) return false;
  if (diamondCount === undefined && !pendingLearnedGiftNameHintPattern.test(name)) return false;
  return true;
}

function knownCatalogImageKeysFor(normalizedName: string, diamondCount: number | undefined): Set<string> {
  const keys = new Set<string>();
  if (diamondCount === undefined) return keys;
  for (const entry of [...(webEntriesByName.get(normalizedName) ?? []), ...(entriesByName.get(normalizedName) ?? [])]) {
    if (entry.diamondCount !== diamondCount) continue;
    for (const imageKey of entry.imageKeys ?? []) {
      const normalizedKey = extractGiftImageKey(imageKey);
      if (normalizedKey) keys.add(normalizedKey);
    }
  }
  return keys;
}

function sanitizeLearnedImageKeys(
  normalizedName: string,
  diamondCount: number | undefined,
  value: Partial<LearnedGiftCatalogEntry>
): string[] | undefined {
  const imageKeys = Array.isArray(value.imageKeys)
    ? Array.from(new Set(value.imageKeys.map(extractGiftImageKey).filter((key): key is string => Boolean(key))))
    : [];
  if (!imageKeys.length) return undefined;

  const knownImageKeys = knownCatalogImageKeysFor(normalizedName, diamondCount);
  if (knownImageKeys.size) {
    const matchedKeys = imageKeys.filter((key) => knownImageKeys.has(key));
    return matchedKeys.length ? matchedKeys : undefined;
  }

  if (imageKeys.length > MAX_LEARNED_IMAGE_KEYS_WITHOUT_CATALOG_MATCH) return undefined;
  return imageKeys;
}

function mergeCatalogEntries(entries: readonly GiftCatalogEntry[]): GiftCatalogEntry[] {
  const mergedEntries = new Map<string, GiftCatalogEntry>();

  for (const entry of entries) {
    const normalizedName = normalizeGiftName(entry.name);
    const key = `${normalizedName}:${entry.diamondCount}`;
    const existing = mergedEntries.get(key);
    if (!existing) {
      mergedEntries.set(key, entry);
      continue;
    }

    mergedEntries.set(key, {
      ...existing,
      ids: Array.from(new Set([...(existing.ids ?? []), ...(entry.ids ?? [])])),
      imageKeys: Array.from(new Set([...(existing.imageKeys ?? []), ...(entry.imageKeys ?? [])]))
    });
  }

  return Array.from(mergedEntries.values());
}

const catalogEntries = mergeCatalogEntries(GIFT_CATALOG_ENTRIES);
const webCatalogEntries = mergeCatalogEntries(GIFT_CATALOG_WEB_ENTRIES);
const entriesByName = new Map<string, GiftCatalogEntry[]>();
const entriesByImageKey = new Map<string, GiftCatalogEntry[]>();
const webEntriesByName = new Map<string, GiftCatalogEntry[]>();
const webEntriesByImageKey = new Map<string, GiftCatalogEntry[]>();
const learnedEntriesByKey = new Map<string, LearnedGiftCatalogEntry>();
const learnedEntriesByName = new Map<string, LearnedGiftCatalogEntry[]>();
const learnedEntriesByImageKey = new Map<string, LearnedGiftCatalogEntry[]>();

function indexEntry<T extends GiftCatalogEntry | LearnedGiftCatalogEntry>(
  entry: T,
  nameIndex: Map<string, T[]>,
  imageKeyIndex: Map<string, T[]>
): void {
  const diamondCount = entry.diamondCount;
  if (typeof diamondCount !== "number" || !Number.isFinite(diamondCount) || diamondCount <= 0) return;

  const normalizedName = normalizeGiftName(entry.name);
  if (normalizedName) {
    const existing = nameIndex.get(normalizedName) ?? [];
    existing.push(entry);
    nameIndex.set(normalizedName, existing);
  }

  for (const imageKey of entry.imageKeys ?? []) {
    const normalizedKey = extractGiftImageKey(imageKey);
    if (!normalizedKey) continue;
    const existing = imageKeyIndex.get(normalizedKey) ?? [];
    existing.push(entry);
    imageKeyIndex.set(normalizedKey, existing);
  }
}

for (const entry of catalogEntries) {
  indexEntry(entry, entriesByName, entriesByImageKey);
}
for (const entry of webCatalogEntries) {
  indexEntry(entry, webEntriesByName, webEntriesByImageKey);
}

function learnedEntryKey(entry: Pick<LearnedGiftCatalogEntry, "name" | "diamondCount">): string {
  return `${normalizeGiftName(entry.name)}:${entry.diamondCount ?? "pending"}`;
}

function rebuildLearnedIndexes(): void {
  learnedEntriesByName.clear();
  learnedEntriesByImageKey.clear();
  for (const entry of learnedEntriesByKey.values()) {
    indexEntry(entry, learnedEntriesByName, learnedEntriesByImageKey);
  }
}

function normalizeLearnedEntry(value: Partial<LearnedGiftCatalogEntry>): LearnedGiftCatalogEntry | null {
  const name = String(value.name || "").trim();
  const normalizedName = normalizeGiftName(name);
  const diamondCount =
    typeof value.diamondCount === "number" && Number.isFinite(value.diamondCount)
      ? Math.round(value.diamondCount)
      : undefined;
  const overriddenDiamondCount = getManualGiftDiamondOverride(normalizedName) ?? diamondCount;
  if (!isLikelyLearnedGiftName(name, normalizedName, overriddenDiamondCount)) return null;
  if (overriddenDiamondCount !== undefined && overriddenDiamondCount <= 0) return null;

  const ids = Array.isArray(value.ids)
    ? Array.from(new Set(value.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
    : undefined;
  const imageKeys = sanitizeLearnedImageKeys(normalizedName, overriddenDiamondCount, value);

  return {
    name,
    diamondCount: overriddenDiamondCount,
    ids: ids?.length ? ids : undefined,
    imageKeys: imageKeys?.length ? imageKeys : undefined,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now()
  };
}

export function registerLearnedGiftCatalogEntries(entries: readonly Partial<LearnedGiftCatalogEntry>[]): void {
  learnedEntriesByKey.clear();
  for (const entry of entries) {
    const normalizedEntry = normalizeLearnedEntry(entry);
    if (!normalizedEntry) continue;
    learnedEntriesByKey.set(learnedEntryKey(normalizedEntry), normalizedEntry);
  }
  rebuildLearnedIndexes();
}

export function upsertLearnedGiftCatalogEntry(
  value: Partial<LearnedGiftCatalogEntry>
): LearnedGiftCatalogEntry | null {
  const incomingEntry = normalizeLearnedEntry(value);
  if (!incomingEntry) return null;

  const key = learnedEntryKey(incomingEntry);
  const existingEntry = learnedEntriesByKey.get(key);
  const nextEntry: LearnedGiftCatalogEntry = existingEntry
    ? {
        ...existingEntry,
        ids: Array.from(new Set([...(existingEntry.ids ?? []), ...(incomingEntry.ids ?? [])])),
        imageKeys: Array.from(new Set([...(existingEntry.imageKeys ?? []), ...(incomingEntry.imageKeys ?? [])])),
        updatedAt: Math.max(existingEntry.updatedAt, incomingEntry.updatedAt)
      }
    : incomingEntry;

  if (incomingEntry.diamondCount !== undefined) {
    learnedEntriesByKey.delete(learnedEntryKey({ name: incomingEntry.name }));
  }
  learnedEntriesByKey.set(key, nextEntry);
  rebuildLearnedIndexes();
  return nextEntry;
}

export function getLearnedGiftCatalogEntries(): LearnedGiftCatalogEntry[] {
  return Array.from(learnedEntriesByKey.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function resolveEntries(
  entries: readonly (GiftCatalogEntry | LearnedGiftCatalogEntry)[] | undefined,
  source: GiftValueSource
): GiftCatalogMatch | null {
  const pricedEntries = entries?.filter(
    (entry): entry is PricedGiftCatalogEntry =>
      typeof entry.diamondCount === "number" && Number.isFinite(entry.diamondCount) && entry.diamondCount > 0
  );
  if (!pricedEntries?.length) return null;

  const diamondCountOptions = Array.from(new Set(pricedEntries.map((entry) => entry.diamondCount))).sort((a, b) => a - b);
  const preferredName = pricedEntries[0]?.name ?? "礼物";
  if (diamondCountOptions.length === 1) {
    return {
      name: preferredName,
      diamondCount: diamondCountOptions[0],
      source,
      confidence: "exact"
    };
  }

  return {
    name: preferredName,
    diamondCountOptions,
    source,
    confidence: "ambiguous"
  };
}

export function lookupGiftByName(name: string | undefined): GiftCatalogMatch | null {
  const normalizedName = normalizeGiftName(name);
  const overriddenDiamondCount = getManualGiftDiamondOverride(normalizedName);
  if (overriddenDiamondCount !== undefined) {
    return {
      name: name?.trim() || "粉丝团灯牌",
      diamondCount: overriddenDiamondCount,
      source: "catalog-name",
      confidence: "exact"
    };
  }

  return (
    resolveEntries(learnedEntriesByName.get(normalizedName), "learned-name") ??
    resolveEntries(webEntriesByName.get(normalizedName), "catalog-name") ??
    resolveEntries(entriesByName.get(normalizedName), "catalog-name")
  );
}

export function lookupGiftByImageKey(imageKey: string | null | undefined): GiftCatalogMatch | null {
  const normalizedKey = extractGiftImageKey(imageKey);
  if (!normalizedKey) return null;
  return (
    resolveEntries(learnedEntriesByImageKey.get(normalizedKey), "learned-image") ??
    resolveEntries(webEntriesByImageKey.get(normalizedKey), "catalog-image") ??
    resolveEntries(entriesByImageKey.get(normalizedKey), "catalog-image")
  );
}

export function lookupGiftByImageUrl(url: string | null | undefined): GiftCatalogMatch | null {
  return lookupGiftByImageKey(extractGiftImageKey(url));
}
