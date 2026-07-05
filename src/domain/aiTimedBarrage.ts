import type { TimedBarrageMode } from "./types";

export const AI_TIMED_BARRAGE_STYLES = [
  {
    id: "warm_call",
    label: "热情打call",
    instruction: "热情、正向、有现场感，适合带动直播间气氛。"
  },
  {
    id: "playful",
    label: "俏皮整活",
    instruction: "俏皮、轻松、有梗，但不要阴阳怪气或攻击观众。"
  },
  {
    id: "soft",
    label: "温柔陪伴",
    instruction: "温柔、陪伴感强，适合唱歌或闲聊直播间。"
  },
  {
    id: "concise",
    label: "克制简短",
    instruction: "简短、自然、不刷屏，像真实房管偶尔提醒。"
  },
  {
    id: "idol",
    label: "应援感",
    instruction: "有应援氛围，偏粉丝打call，可以使用少量常见直播间表情。"
  }
] as const;

export type AiTimedBarrageStyleId = (typeof AI_TIMED_BARRAGE_STYLES)[number]["id"];

export interface AiTimedBarragePromptInput {
  styleId: AiTimedBarrageStyleId;
  mode: TimedBarrageMode;
  examples: string[];
  maxLength: number;
}

export function resolveAiTimedBarrageStyle(styleId: string | undefined): (typeof AI_TIMED_BARRAGE_STYLES)[number] {
  return AI_TIMED_BARRAGE_STYLES.find((style) => style.id === styleId) ?? AI_TIMED_BARRAGE_STYLES[0];
}

export function createAiTimedBarrageMessages(input: AiTimedBarragePromptInput): Array<{ role: "system" | "user"; content: string }> {
  const style = resolveAiTimedBarrageStyle(input.styleId);
  const examples = input.examples.slice(0, 16);
  const exampleText = examples.length ? examples.map((text, index) => `${index + 1}. ${text}`).join("\n") : "暂无样例";
  const modeText = input.mode === "sequential" ? "顺序轮播" : "随机轮播";

  return [
    {
      role: "system",
      content:
        "你是抖音直播间房管助手，只生成一条可直接发送的中文直播弹幕。不要解释、不要编号、不要引号、不要换行。"
    },
    {
      role: "user",
      content: [
        `当前定时弹幕池模式：${modeText}`,
        `目标风格：${style.label}，${style.instruction}`,
        `长度上限：${input.maxLength} 个中文字符以内。`,
        "要求：和下面本地定时弹幕池的主题、语气、主播称呼保持一致；不要包含敏感词、联系方式、价格、抽奖承诺；不要重复样例原句。",
        "本地定时弹幕池样例：",
        exampleText
      ].join("\n")
    }
  ];
}

export function cleanAiTimedBarrageText(value: unknown, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
