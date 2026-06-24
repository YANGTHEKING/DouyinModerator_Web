import { GIFT_CATALOG_ENTRIES, type GiftCatalogEntry as GeneratedGiftCatalogEntry } from "../data/giftCatalog.generated";
import type { GiftValueSource } from "./types";

type GiftCatalogEntry = GeneratedGiftCatalogEntry;

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
    .replace(/[：:，,。.!！?？"'“”‘’]/gu, "")
    .trim()
    .toLowerCase();
}

export function extractGiftImageKey(value: string | null | undefined): string | null {
  const match = value?.match(IMAGE_KEY_PATTERN);
  return match?.[0]?.toLowerCase() ?? null;
}

const catalogEntries = GIFT_CATALOG_ENTRIES as readonly GiftCatalogEntry[];
const entriesByName = new Map<string, GiftCatalogEntry[]>();
const entriesByImageKey = new Map<string, GiftCatalogEntry[]>();

for (const entry of catalogEntries) {
  if (!Number.isFinite(entry.diamondCount) || entry.diamondCount <= 0) continue;

  const normalizedName = normalizeGiftName(entry.name);
  if (normalizedName) {
    const existing = entriesByName.get(normalizedName) ?? [];
    existing.push(entry);
    entriesByName.set(normalizedName, existing);
  }

  for (const imageKey of entry.imageKeys ?? []) {
    const normalizedKey = extractGiftImageKey(imageKey);
    if (!normalizedKey) continue;
    const existing = entriesByImageKey.get(normalizedKey) ?? [];
    existing.push(entry);
    entriesByImageKey.set(normalizedKey, existing);
  }
}

function resolveEntries(
  entries: readonly GiftCatalogEntry[] | undefined,
  source: GiftValueSource
): GiftCatalogMatch | null {
  if (!entries?.length) return null;

  const diamondCountOptions = Array.from(new Set(entries.map((entry) => entry.diamondCount))).sort((a, b) => a - b);
  const preferredName = entries[0]?.name ?? "礼物";
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
  return resolveEntries(entriesByName.get(normalizeGiftName(name)), "catalog-name");
}

export function lookupGiftByImageKey(imageKey: string | null | undefined): GiftCatalogMatch | null {
  const normalizedKey = extractGiftImageKey(imageKey);
  if (!normalizedKey) return null;
  return resolveEntries(entriesByImageKey.get(normalizedKey), "catalog-image");
}

export function lookupGiftByImageUrl(url: string | null | undefined): GiftCatalogMatch | null {
  return lookupGiftByImageKey(extractGiftImageKey(url));
}
