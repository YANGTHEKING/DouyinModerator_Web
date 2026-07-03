import type { AutomationRule, LiveEvent } from "./types";
import { giftDiamondTotal } from "./giftReplyTiers";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function patternMatches(pattern: string, value: string | undefined): boolean {
  const normalizedPattern = normalize(pattern || "*");
  if (normalizedPattern === "*" || normalizedPattern === "") return true;
  return normalize(value ?? "").includes(normalizedPattern);
}

function giftMeetsDiamondThreshold(rule: AutomationRule, event: LiveEvent): boolean {
  const threshold = Math.max(0, rule.minGiftDiamondCount);
  if (threshold <= 0) return true;

  const total = giftDiamondTotal(event);
  return typeof total === "number" && total >= threshold;
}

export function ruleMatchesEvent(rule: AutomationRule, event: LiveEvent): boolean {
  if (!rule.enabled) return false;

  switch (rule.trigger) {
    case "member":
      return event.type === "member";
    case "follow":
      return event.type === "follow";
    case "gift":
      return event.type === "gift" && giftMeetsDiamondThreshold(rule, event);
    case "specificGift":
      return (
        event.type === "gift" &&
        patternMatches(rule.matchPattern, event.giftName) &&
        giftMeetsDiamondThreshold(rule, event)
      );
    case "fansclub":
      return event.type === "fansclub";
    case "like":
      return event.type === "like";
    case "monthlyMember":
      return event.type === "monthlyMember";
    case "annualMember":
      return event.type === "annualMember";
    case "starGuardian":
      return event.type === "starGuardian";
    case "chatKeyword":
      return event.type === "chat" && patternMatches(rule.matchPattern, event.content);
  }
}

export function giftRuleBlockReason(rule: AutomationRule, event: LiveEvent): string | undefined {
  if (!rule.enabled) return undefined;
  if (rule.trigger !== "gift" && rule.trigger !== "specificGift") return undefined;
  if (event.type !== "gift") return undefined;
  if (rule.trigger === "specificGift" && !patternMatches(rule.matchPattern, event.giftName)) {
    return `礼物「${event.giftName ?? "礼物"}」不匹配「${rule.matchPattern || "*"}」`;
  }

  const threshold = Math.max(0, rule.minGiftDiamondCount);
  if (threshold <= 0) return undefined;

  const total = giftDiamondTotal(event);
  if (typeof total !== "number") {
    return `礼物「${event.giftName ?? "礼物"}」价值待确认，无法判断是否达到 ${threshold} 钻门槛`;
  }
  if (total < threshold) return `礼物「${event.giftName ?? "礼物"}」价值 ${total} 钻，低于 ${threshold} 钻门槛`;

  return undefined;
}

export function canFireRule(
  rule: AutomationRule,
  lastFiredAt: number | undefined,
  now: number
): boolean {
  if (!lastFiredAt) return true;
  return now - lastFiredAt >= rule.cooldownSeconds * 1000;
}
