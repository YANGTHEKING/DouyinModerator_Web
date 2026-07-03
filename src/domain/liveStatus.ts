export type LiveStatus = "live" | "offline" | "unknown";

export interface LiveStatusSnapshot {
  status: LiveStatus;
  source: "dom" | "fetch" | "combined";
  detail?: string;
}

const OFFLINE_TEXT_PATTERN = /直播已结束|暂未开播|还未开播|未开播|主播不在|主播暂时不在|休息中|开播提醒|预约直播/u;
const LIVE_TEXT_PATTERN = /在线观众|本场点赞|小时榜|人气榜|加入了直播间|送出了|送出/u;
const LIVE_STREAM_PATTERN = /flv_pull_url|hls_pull_url|live_core_sdk_data|pull_data/u;
const OFFLINE_HTML_PATTERN = /直播已结束|暂未开播|还未开播|未开播|开播提醒|room_status["']?\s*[:=]\s*["']?(?:4|false)/u;

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
  if (OFFLINE_HTML_PATTERN.test(html)) return { status: "offline", source: "fetch", detail: "offline-html" };
  if (LIVE_STREAM_PATTERN.test(html)) return { status: "live", source: "fetch", detail: "stream-data" };
  return { status: "unknown", source: "fetch" };
}

export async function checkDouyinLiveStatus(url = window.location.href): Promise<LiveStatusSnapshot> {
  const domStatus = detectLiveStatusFromDom();
  if (domStatus.status === "live") return domStatus;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include"
    });
    const html = await response.text();
    const fetchedStatus = detectLiveStatusFromHtml(html);
    if (fetchedStatus.status !== "unknown") return { ...fetchedStatus, source: "combined" };
  } catch {
    // DOM status is still useful when the network probe is blocked or throttled.
  }

  return domStatus;
}
