import {
  getLearnedGiftCatalogEntries,
  registerLearnedGiftCatalogEntries,
  upsertLearnedGiftCatalogEntry,
  type LearnedGiftCatalogEntry
} from "../domain/giftCatalog";

const STORAGE_KEY = "learnedGiftCatalogV1";
const MAX_LEARNED_GIFT_ENTRIES = 3000;
const SAVE_DEBOUNCE_MS = 800;

let loadPromise: Promise<void> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function normalizeStoredEntries(value: unknown): Partial<LearnedGiftCatalogEntry>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => entry as Partial<LearnedGiftCatalogEntry>);
}

async function readStoredEntries(): Promise<Partial<LearnedGiftCatalogEntry>[]> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeStoredEntries(result[STORAGE_KEY]);
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    return normalizeStoredEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeStoredEntries(entries: readonly LearnedGiftCatalogEntry[]): Promise<void> {
  const boundedEntries = entries.slice(0, MAX_LEARNED_GIFT_ENTRIES);
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: boundedEntries });
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(boundedEntries));
}

export async function loadLearnedGiftCatalog(): Promise<void> {
  loadPromise ??= readStoredEntries().then(async (entries) => {
    registerLearnedGiftCatalogEntries(entries);
    try {
      await saveLearnedGiftCatalog();
    } catch (error) {
      console.warn("Failed to persist sanitized learned gift catalog", error);
    }
  });
  return loadPromise;
}

export async function saveLearnedGiftCatalog(): Promise<void> {
  await writeStoredEntries(getLearnedGiftCatalogEntries());
}

function scheduleSaveLearnedGiftCatalog(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveLearnedGiftCatalog();
  }, SAVE_DEBOUNCE_MS);
}

export function learnGiftCatalogEntry(
  value: Partial<LearnedGiftCatalogEntry>
): LearnedGiftCatalogEntry | null {
  const learnedEntry = upsertLearnedGiftCatalogEntry(value);
  if (learnedEntry) scheduleSaveLearnedGiftCatalog();
  return learnedEntry;
}
