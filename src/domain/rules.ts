import type { AutomationRule, LiveEvent } from "./types";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function patternMatches(pattern: string, value: string | undefined): boolean {
  const normalizedPattern = normalize(pattern || "*");
  if (normalizedPattern === "*" || normalizedPattern === "") return true;
  return normalize(value ?? "").includes(normalizedPattern);
}

export function ruleMatchesEvent(rule: AutomationRule, event: LiveEvent): boolean {
  if (!rule.enabled) return false;

  switch (rule.trigger) {
    case "member":
      return event.type === "member";
    case "follow":
      return event.type === "follow";
    case "gift":
      return event.type === "gift";
    case "specificGift":
      return event.type === "gift" && patternMatches(rule.matchPattern, event.giftName);
    case "fansclub":
      return event.type === "fansclub";
    case "like":
      return event.type === "like";
    case "chatKeyword":
      return event.type === "chat" && patternMatches(rule.matchPattern, event.content);
  }
}

export function canFireRule(
  rule: AutomationRule,
  lastFiredAt: number | undefined,
  now: number
): boolean {
  if (!lastFiredAt) return true;
  return now - lastFiredAt >= rule.cooldownSeconds * 1000;
}
