export const PRIMARY_LIVE_ROOM_ID = "730660348009";

const STORAGE_KEY = "runtimeSettingsV1";

export interface RuntimeSettings {
  developerModeEnabled: boolean;
}

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  developerModeEnabled: false
};

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export function normalizeRuntimeSettings(value: unknown): RuntimeSettings {
  void value;
  return {
    developerModeEnabled: false
  };
}

export async function loadRuntimeSettings(): Promise<RuntimeSettings> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeRuntimeSettings(result[STORAGE_KEY]);
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_RUNTIME_SETTINGS;

  try {
    return normalizeRuntimeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_RUNTIME_SETTINGS;
  }
}

export async function saveRuntimeSettings(settings: RuntimeSettings): Promise<void> {
  const nextSettings = normalizeRuntimeSettings(settings);
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: nextSettings });
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
}

export function isRuntimeSettingsStorageKey(key: string): boolean {
  return key === STORAGE_KEY;
}

export function liveRoomIdFromUrl(url: Location | URL): string | undefined {
  const match = url.pathname.match(/^\/(\d+)/u);
  return match?.[1];
}

export function isPrimaryLiveRoomUrl(url: Location | URL): boolean {
  return url.hostname === "live.douyin.com" && liveRoomIdFromUrl(url) === PRIMARY_LIVE_ROOM_ID;
}

export function isLocalDevelopmentUrl(url: Location | URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

export function isAssistantAllowedOnUrl(url: Location | URL, settings: RuntimeSettings): boolean {
  if (isLocalDevelopmentUrl(url)) return true;
  if (isPrimaryLiveRoomUrl(url)) return true;
  return url.hostname === "live.douyin.com" && settings.developerModeEnabled;
}
