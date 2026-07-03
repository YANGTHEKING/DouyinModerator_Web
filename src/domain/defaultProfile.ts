import { DEFAULT_TIMED_BARRAGE_ITEMS } from "../data/defaultTimedBarragePool";
import { createId } from "./ids";
import { createDefaultGiftReplyTiers } from "./giftReplyTiers";
import type { AssistantProfile, AutomationRule, ScheduledAction, TimedBarragePool } from "./types";

export function createDefaultRules(): AutomationRule[] {
  return [
    {
      id: createId("rule"),
      name: "欢迎进入",
      trigger: "member",
      matchPattern: "*",
      replyTemplate: "欢迎 {user} 来到直播间！[欢迎]",
      cooldownSeconds: 10,
      minGiftDiamondCount: 0,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢关注",
      trigger: "follow",
      matchPattern: "*",
      replyTemplate: "感谢 {user} 的关注！[比心]",
      cooldownSeconds: 10,
      minGiftDiamondCount: 0,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢礼物",
      trigger: "gift",
      matchPattern: "*",
      replyTemplate: "感谢 {user} 送的{gift}！[玫瑰]",
      giftReplyTiers: createDefaultGiftReplyTiers(),
      cooldownSeconds: 10,
      minGiftDiamondCount: 0,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢入团",
      trigger: "fansclub",
      matchPattern: "*",
      replyTemplate: "欢迎 {user} 加入粉丝团！[666]",
      cooldownSeconds: 10,
      minGiftDiamondCount: 0,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢月度会员",
      trigger: "monthlyMember",
      matchPattern: "*",
      replyTemplate: "感谢 {user} {membership}，欢迎加入会员大家庭！[比心]",
      cooldownSeconds: 10,
      minGiftDiamondCount: 0,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢年度会员",
      trigger: "annualMember",
      matchPattern: "*",
      replyTemplate: "感谢 {user} {membership}，年度支持太给力了！[玫瑰]",
      cooldownSeconds: 10,
      minGiftDiamondCount: 0,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢星守护",
      trigger: "starGuardian",
      matchPattern: "*",
      replyTemplate: "感谢 {user} {membership}，星光守护收到啦！[比心]",
      cooldownSeconds: 10,
      minGiftDiamondCount: 0,
      enabled: false
    }
  ];
}

export function createDefaultScheduledActions(): ScheduledAction[] {
  return [
    {
      id: createId("scheduled"),
      kind: "like",
      label: "自动点赞",
      intervalSeconds: 30,
      enabled: false
    }
  ];
}

export function createDefaultTimedBarragePool(): TimedBarragePool {
  return {
    enabled: false,
    intervalSeconds: 120,
    mode: "random",
    items: DEFAULT_TIMED_BARRAGE_ITEMS
  };
}

export function createDefaultProfile(): AssistantProfile {
  return {
    schemaVersion: 1,
    rules: createDefaultRules(),
    timedBarragePool: createDefaultTimedBarragePool(),
    scheduledActions: createDefaultScheduledActions(),
    globalSendIntervalSeconds: 5,
    maxReplyLength: 80,
    verifyBarrageInputBeforeSend: true,
    updatedAt: Date.now()
  };
}
