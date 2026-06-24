import type { LiveEvent } from "./types";

function normalize(value: string | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function createEventFingerprint(event: Omit<LiveEvent, "id" | "fingerprint">): string {
  const timeBucket = Math.floor(event.timestamp / 8000);
  const eventText = event.giftName || event.content || event.rawText;
  return [
    event.type,
    normalize(event.userName),
    normalize(eventText),
    event.count ?? "",
    timeBucket
  ].join("|");
}
