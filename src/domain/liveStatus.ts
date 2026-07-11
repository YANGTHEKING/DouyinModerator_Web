export type LiveStatus = "live" | "offline" | "unknown";

export interface LiveStatusSnapshot {
  status: LiveStatus;
  source: "dom" | "fetch" | "combined";
  detail?: string;
}

const OFFLINE_TEXT_PATTERN = /直播已结束|暂未开播|还未开播|未开播|主播不在|主播暂时不在|休息中|开播提醒|预约直播/u;
const LIVE_TEXT_PATTERN = /在线观众|本场点赞|小时榜|人气榜|加入了直播间|送出了|送出/u;
const OFFLINE_HTML_PATTERN = /直播已结束|暂未开播|还未开播|未开播|开播提醒|room_status["']?\s*[:=]\s*["']?(?:4|false)/u;
const ROOM_STATUS_PATTERN = /"roomStore"\s*:\s*\{\s*"roomInfo"\s*:\s*\{\s*"room"\s*:\s*\{[\s\S]{0,4096}?"status"\s*:\s*"?([24])"?/u;

function bodyText(): string {
  return document.body?.innerText?.replace(/\s+/g, " ").slice(0, 12000) ?? "";
}

function hasPlayingVideo(): boolean {
  return Array.from(document.querySelectorAll("video")).some((video) => {
    return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.paused && !video.ended;
  });
}

export function detectLiveStatusFromDom(): LiveStatusSnapshot {
  const text = bodyText();
  const videoCount = document.querySelectorAll("video").length;

  if (OFFLINE_TEXT_PATTERN.test(text)) return { status: "offline", source: "dom", detail: "offline-text" };
  if (videoCount > 0 && LIVE_TEXT_PATTERN.test(text)) {
    return { status: "live", source: "dom", detail: hasPlayingVideo() ? "playing-live-video" : "live-page-text" };
  }

  return { status: "unknown", source: "dom" };
}

export function detectLiveStatusFromHtml(html: string): LiveStatusSnapshot {
  // DouyinLiveRecorder polls a fresh room page and reads roomInfo.room.status.
  // React's streamed HTML escapes the embedded room JSON, so normalize its quotes first.
  const normalizedHtml = html.replace(/\\"/g, '"');
  const roomStatus = ROOM_STATUS_PATTERN.exec(normalizedHtml)?.[1];
  if (roomStatus === "2") return { status: "live", source: "fetch", detail: "room-status-2" };
  if (roomStatus === "4") return { status: "offline", source: "fetch", detail: "room-status-4" };

  if (OFFLINE_HTML_PATTERN.test(html)) return { status: "offline", source: "fetch", detail: "offline-html" };
  return { status: "unknown", source: "fetch" };
}

export async function checkDouyinLiveStatus(url = window.location.href): Promise<LiveStatusSnapshot> {
  try {
    const probeUrl = new URL(url, window.location.href);
    probeUrl.searchParams.set("dmw_live_probe", String(Date.now()));
    probeUrl.hash = "";
    const response = await fetch(probeUrl.toString(), {
      cache: "no-store",
      credentials: "include",
      redirect: "follow"
    });
    if (!response.ok) throw new Error(`Live status probe failed: ${response.status}`);
    const html = await response.text();
    const fetchedStatus = detectLiveStatusFromHtml(html);
    if (fetchedStatus.status !== "unknown") return fetchedStatus;
  } catch {
    // A transient probe failure must not turn a stale, unrefreshed video page into a live signal.
  }

  return { status: "unknown", source: "fetch", detail: "room-status-unavailable" };
}
