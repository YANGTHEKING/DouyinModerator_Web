import { describe, expect, it } from "vitest";
import { isAssistantAllowedOnUrl, normalizeRuntimeSettings, PRIMARY_LIVE_ROOM_ID } from "../src/storage/runtimeSettings";

describe("runtime settings", () => {
  it("keeps developer mode disabled even when old storage has it enabled", () => {
    expect(normalizeRuntimeSettings({ developerModeEnabled: true })).toEqual({ developerModeEnabled: false });
  });

  it("allows the assistant on the primary room but not other Douyin live rooms", () => {
    const settings = normalizeRuntimeSettings({ developerModeEnabled: true });

    expect(isAssistantAllowedOnUrl(new URL(`https://live.douyin.com/${PRIMARY_LIVE_ROOM_ID}`), settings)).toBe(true);
    expect(isAssistantAllowedOnUrl(new URL("https://live.douyin.com/123456789"), settings)).toBe(false);
  });
});
