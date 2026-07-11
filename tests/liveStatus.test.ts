import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDouyinLiveStatus, detectLiveStatusFromHtml } from "../src/domain/liveStatus";

function roomHtml(status: 2 | 4, escaped = true): string {
  const payload = `{"roomStore":{"roomInfo":{"room":{"id_str":"123","status":${status},"status_str":"${status}"}}}}`;
  return escaped ? `<script>self.__pace_f.push([1,"${payload.replace(/"/g, '\\"')}"])</script>` : payload;
}

describe("Douyin live status detection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("reads live and offline room status from DouyinLiveRecorder-style room data", () => {
    expect(detectLiveStatusFromHtml(roomHtml(2))).toEqual({
      status: "live",
      source: "fetch",
      detail: "room-status-2"
    });
    expect(detectLiveStatusFromHtml(roomHtml(4, false))).toEqual({
      status: "offline",
      source: "fetch",
      detail: "room-status-4"
    });
  });

  it("does not treat stream URL text as the live-status source", () => {
    expect(detectLiveStatusFromHtml('{"flv_pull_url":"https://example.test/live.flv"}')).toEqual({
      status: "unknown",
      source: "fetch"
    });
  });

  it("uses the fresh server room status even when the current DOM still looks live", async () => {
    document.body.innerHTML = "<video></video><div>在线观众 本场点赞</div>";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(roomHtml(4), {
        status: 200,
        headers: { "Content-Type": "text/html" }
      })
    );

    await expect(checkDouyinLiveStatus("https://live.douyin.com/730660348009#stale-player")).resolves.toEqual({
      status: "offline",
      source: "fetch",
      detail: "room-status-4"
    });

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.hash).toBe("");
    expect(requestedUrl.searchParams.get("dmw_live_probe")).toMatch(/^\d+$/);
  });

  it("returns unknown instead of trusting stale DOM when the room probe fails", async () => {
    document.body.innerHTML = "<video></video><div>在线观众 本场点赞</div>";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));

    await expect(checkDouyinLiveStatus()).resolves.toEqual({
      status: "unknown",
      source: "fetch",
      detail: "room-status-unavailable"
    });
  });
});
