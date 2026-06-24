import type { LiveEventType, QueueStatus, SessionLogKind, TriggerSupport, TriggerType } from "./types";

export const triggerLabels: Record<TriggerType, string> = {
  member: "进入房间",
  follow: "关注主播",
  gift: "收到礼物",
  specificGift: "特定礼物",
  fansclub: "加入粉丝团",
  like: "点赞",
  chatKeyword: "聊天关键词"
};

export const liveEventLabels: Record<LiveEventType, string> = {
  member: "进入",
  chat: "聊天",
  gift: "礼物",
  like: "点赞",
  follow: "关注",
  fansclub: "入团",
  system: "系统"
};

export const supportLabels: Record<TriggerSupport, string> = {
  supported: "已支持",
  partial: "部分支持",
  pending: "待适配"
};

export const queueStatusLabels: Record<QueueStatus, string> = {
  pending: "等待",
  sending: "发送中",
  sent: "已发送",
  blocked: "已拦截",
  failed: "失败"
};

export const logKindLabels: Record<SessionLogKind, string> = {
  event: "事件",
  assistant: "助手",
  send: "发送",
  warning: "提醒",
  error: "错误"
};
