import { createId } from "./ids";
import type { AssistantProfile, AutomationRule, ScheduledAction } from "./types";

export function createDefaultRules(): AutomationRule[] {
  return [
    {
      id: createId("rule"),
      name: "欢迎进入",
      trigger: "member",
      matchPattern: "*",
      replyTemplate: "欢迎 {user} 来到直播间！[欢迎]",
      cooldownSeconds: 10,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢关注",
      trigger: "follow",
      matchPattern: "*",
      replyTemplate: "感谢 {user} 的关注！[比心]",
      cooldownSeconds: 10,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢礼物",
      trigger: "gift",
      matchPattern: "*",
      replyTemplate: "感谢 {user} 送的{gift}！[玫瑰]",
      cooldownSeconds: 10,
      enabled: false
    },
    {
      id: createId("rule"),
      name: "感谢入团",
      trigger: "fansclub",
      matchPattern: "*",
      replyTemplate: "欢迎 {user} 加入粉丝团！[666]",
      cooldownSeconds: 10,
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

export function createDefaultProfile(): AssistantProfile {
  return {
    schemaVersion: 1,
    rules: createDefaultRules(),
    scheduledActions: createDefaultScheduledActions(),
    globalSendIntervalSeconds: 5,
    maxReplyLength: 80,
    updatedAt: Date.now()
  };
}
