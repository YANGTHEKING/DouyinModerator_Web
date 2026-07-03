export const TRIGGER_TYPES = [
  "member",
  "follow",
  "gift",
  "specificGift",
  "fansclub",
  "like",
  "monthlyMember",
  "annualMember",
  "starGuardian",
  "chatKeyword"
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

export type TriggerSupport = "supported" | "partial" | "pending";

export type LiveEventType =
  | "member"
  | "chat"
  | "gift"
  | "like"
  | "follow"
  | "fansclub"
  | "monthlyMember"
  | "annualMember"
  | "starGuardian"
  | "system";

export type GiftValueSource = "catalog-name" | "catalog-image" | "learned-name" | "learned-image" | "page-panel";

export interface LiveEvent {
  id: string;
  type: LiveEventType;
  fingerprint: string;
  userName: string;
  fanClubName?: string;
  content: string;
  giftName?: string;
  count?: number;
  giftDiamondCount?: number;
  giftTotalDiamondCount?: number;
  giftValueSource?: GiftValueSource;
  giftValueAmbiguous?: boolean;
  giftDiamondCountOptions?: number[];
  rawText: string;
  timestamp: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: TriggerType;
  matchPattern: string;
  replyTemplate: string;
  giftReplyTiers?: GiftReplyTier[];
  cooldownSeconds: number;
  minGiftDiamondCount: number;
  enabled: boolean;
}

export interface GiftReplyTier {
  id: string;
  replyTemplate: string;
}

export type TimedBarrageMode = "random" | "sequential";

export interface TimedBarragePool {
  enabled: boolean;
  intervalSeconds: number;
  mode: TimedBarrageMode;
  items: TimedBarrageItem[];
}

export interface TimedBarrageItem {
  id: string;
  label: string;
  text: string;
  enabled: boolean;
}

export type ScheduledAction = ScheduledBarrageAction | ScheduledLikeAction;

export interface ScheduledBarrageAction {
  id: string;
  kind: "barrage";
  label: string;
  text: string;
  intervalSeconds: number;
  enabled: boolean;
}

export interface ScheduledLikeAction {
  id: string;
  kind: "like";
  label: string;
  intervalSeconds: number;
  enabled: boolean;
}

export interface AssistantProfile {
  schemaVersion: 1;
  rules: AutomationRule[];
  timedBarragePool: TimedBarragePool;
  scheduledActions: ScheduledAction[];
  globalSendIntervalSeconds: number;
  maxReplyLength: number;
  verifyBarrageInputBeforeSend: boolean;
  updatedAt: number;
}

export type QueueStatus = "pending" | "sending" | "sent" | "blocked" | "failed";

export interface SendQueueItem {
  id: string;
  text: string;
  source: string;
  status: QueueStatus;
  createdAt: number;
  allowRepeat?: boolean;
  sentAt?: number;
  error?: string;
  eventId?: string;
}

export type SessionLogKind = "event" | "assistant" | "send" | "warning" | "error";

export interface SessionLogEntry {
  id: string;
  kind: SessionLogKind;
  eventType?: LiveEventType;
  userName: string;
  message: string;
  timestamp: number;
}

export interface PageSendResult {
  ok: boolean;
  error?: string;
}

export interface PageSendOptions {
  verifyInputWrite?: boolean;
}

export interface PageAdapter {
  observeInteractionFeed: (onEvent: (event: LiveEvent) => void) => () => void;
  sendBarrage: (text: string, options?: PageSendOptions) => Promise<PageSendResult>;
  sendLike: () => Promise<PageSendResult>;
  getTriggerSupport: (trigger: TriggerType) => TriggerSupport;
}
