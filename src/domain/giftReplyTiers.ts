import type { AutomationRule, GiftReplyTier, LiveEvent } from "./types";

export interface GiftReplyTierDefinition {
  id: string;
  label: string;
  minDiamondCount: number;
  maxDiamondCount?: number;
}

export const GIFT_REPLY_TIER_DEFINITIONS: GiftReplyTierDefinition[] = [
  { id: "99_298", label: "99-298钻", minDiamondCount: 99, maxDiamondCount: 299 },
  { id: "299_979", label: "299-979钻", minDiamondCount: 299, maxDiamondCount: 980 },
  { id: "980_2999", label: "980-2999钻", minDiamondCount: 980, maxDiamondCount: 3000 },
  { id: "3000_9999", label: "3000-9999钻", minDiamondCount: 3000, maxDiamondCount: 10000 },
  { id: "10000_29999", label: "10000-29999钻", minDiamondCount: 10000, maxDiamondCount: 30000 },
  { id: "30000_plus", label: "30000钻以上", minDiamondCount: 30000 }
];

const DEFAULT_GIFT_REPLY_TEMPLATES: Record<string, string> = {
  "99_298": "感谢 {user} 送的{gift}，心意收到啦！[比心]",
  "299_979": "感谢 {user} 的{gift}，这份支持太暖了！[玫瑰]",
  "980_2999": "感谢 {user} 送出的{gift}，老板大气，祝你把把顺风！[鼓掌]",
  "3000_9999": "感谢 {user} 豪送{gift}，这波排面拉满！[666]",
  "10000_29999": "感谢 {user} 的{gift}，全场都看见这份支持了！[烟花]",
  "30000_plus": "感谢 {user} 豪气送出{gift}，这份大礼太顶了！[烟花]"
};

export function createDefaultGiftReplyTiers(): GiftReplyTier[] {
  return GIFT_REPLY_TIER_DEFINITIONS.map((definition) => ({
    id: definition.id,
    replyTemplate: DEFAULT_GIFT_REPLY_TEMPLATES[definition.id] || ""
  }));
}

export function normalizeGiftReplyTiers(value: unknown): GiftReplyTier[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const allowedIds = new Set(GIFT_REPLY_TIER_DEFINITIONS.map((definition) => definition.id));
  const importedTiers = new Map<string, string>();
  value.forEach((tier) => {
    const source = tier as Partial<GiftReplyTier>;
    const id = String(source.id || "");
    if (!allowedIds.has(id)) return;
    importedTiers.set(id, String(source.replyTemplate || ""));
  });

  return createDefaultGiftReplyTiers().map((defaultTier) => {
    const importedTemplate = importedTiers.get(defaultTier.id)?.trim();
    return {
      id: defaultTier.id,
      replyTemplate: importedTemplate || defaultTier.replyTemplate
    };
  });
}

export function giftDiamondTotal(event: LiveEvent): number | undefined {
  if (typeof event.giftTotalDiamondCount === "number") return event.giftTotalDiamondCount;
  if (typeof event.giftDiamondCount === "number") return event.giftDiamondCount * (event.count ?? 1);
  return undefined;
}

export function resolveGiftReplyTemplate(rule: AutomationRule, event: LiveEvent): string {
  if (event.type !== "gift") return rule.replyTemplate;
  if (rule.trigger !== "gift" && rule.trigger !== "specificGift") return rule.replyTemplate;

  const total = giftDiamondTotal(event);
  if (typeof total !== "number") return rule.replyTemplate;

  const definition = GIFT_REPLY_TIER_DEFINITIONS.find((tier) => {
    return total >= tier.minDiamondCount && (tier.maxDiamondCount === undefined || total < tier.maxDiamondCount);
  });
  if (!definition) return rule.replyTemplate;

  const tierTemplate = rule.giftReplyTiers?.find((tier) => tier.id === definition.id)?.replyTemplate.trim();
  return tierTemplate || rule.replyTemplate;
}
