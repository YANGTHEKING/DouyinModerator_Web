import type { LiveEvent } from "./types";

export function resolveReplyTemplate(template: string, event: LiveEvent): string {
  const replacements: Record<string, string> = {
    user: event.userName || "用户",
    fanclub: event.fanClubName || "",
    gift: event.giftName || "",
    count: typeof event.count === "number" ? String(event.count) : "",
    diamonds: typeof event.giftDiamondCount === "number" ? String(event.giftDiamondCount) : "",
    totalDiamonds: typeof event.giftTotalDiamondCount === "number" ? String(event.giftTotalDiamondCount) : "",
    content: event.content || "",
    membership: event.content || ""
  };

  return template.replace(/\{(user|fanclub|gift|count|diamonds|totalDiamonds|content|membership)\}/g, (_, key: string) => {
    return replacements[key] ?? "";
  });
}
