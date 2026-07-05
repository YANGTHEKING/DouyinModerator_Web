import type { TimedBarrageMode } from "./types";

export const AI_TIMED_BARRAGE_REGULAR_STYLES = [
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

export const AI_TIMED_BARRAGE_CHITCHAT_STYLES = [
  {
    id: "topic_light_question",
    label: "轻松提问",
    instruction: "像真实观众一样自然抛问题，留给主播或观众一句话就能接住。"
  },
  {
    id: "topic_choice",
    label: "二选一",
    instruction: "用选择题或投票式问法带动弹幕参与，不要让问题太复杂。"
  },
  {
    id: "topic_playful",
    label: "玩梗接话",
    instruction: "轻松有梗，但不阴阳怪气，不把话题带偏到争吵。"
  },
  {
    id: "topic_soft",
    label: "温和闲聊",
    instruction: "语气柔和、有陪伴感，适合慢节奏聊天或唱歌直播间。"
  },
  {
    id: "topic_direct",
    label: "直给开聊",
    instruction: "短句直接开题，适合直播间节奏快、需要快速引出话题。"
  }
] as const;

export const AI_TIMED_BARRAGE_COMFORT_STYLES = [
  {
    id: "comfort_angry",
    label: "安慰生气",
    instruction: "先给情绪降温，表达理解和站在对方这边，不说教、不拱火。"
  },
  {
    id: "comfort_sad",
    label: "安慰伤心",
    instruction: "温柔接住难过情绪，给一点陪伴感和轻轻的鼓励。"
  },
  {
    id: "comfort_frustrated",
    label: "安慰沮丧",
    instruction: "承认低落和不顺，帮对方把注意力放回下一步，不强行鸡血。"
  },
  {
    id: "comfort_stressed",
    label: "缓和压力",
    instruction: "语气稳定、放松，让对方先缓一缓，不催促、不制造压力。"
  },
  {
    id: "comfort_encourage",
    label: "温柔打气",
    instruction: "轻轻加油，表达相信和支持，适合把直播间气氛拉回正向。"
  }
] as const;

export const AI_TIMED_BARRAGE_STYLES = AI_TIMED_BARRAGE_REGULAR_STYLES;

export type AiTimedBarrageStyleId =
  | (typeof AI_TIMED_BARRAGE_REGULAR_STYLES)[number]["id"]
  | (typeof AI_TIMED_BARRAGE_CHITCHAT_STYLES)[number]["id"]
  | (typeof AI_TIMED_BARRAGE_COMFORT_STYLES)[number]["id"];

export const AI_TIMED_BARRAGE_INTENTS = [
  {
    id: "regular",
    label: "普通互动",
    instruction: "生成常规直播间互动弹幕，延续本地弹幕池的称呼、节奏和气氛。"
  },
  {
    id: "chitchat_topic",
    label: "杂谈话题",
    instruction: "主动抛出一个轻松可接的话题，让主播或观众能自然接话。"
  },
  {
    id: "comfort",
    label: "安慰鼓励",
    instruction: "生成安慰主播或观众情绪的弹幕，接住生气、伤心、沮丧等状态。"
  }
] as const;

export type AiTimedBarrageIntentId = (typeof AI_TIMED_BARRAGE_INTENTS)[number]["id"];

export const AI_TIMED_BARRAGE_TOPIC_TARGETS = [
  {
    id: "host",
    label: "主播",
    instruction: "面向主播提问或递话题，语气自然亲切，不给主播压力。"
  },
  {
    id: "audience",
    label: "观众",
    instruction: "面向直播间观众抛话题，适合大家用弹幕一起回答。"
  }
] as const;

export type AiTimedBarrageTopicTargetId = (typeof AI_TIMED_BARRAGE_TOPIC_TARGETS)[number]["id"];

export const AI_TIMED_BARRAGE_TOPIC_CATEGORIES = [
  {
    id: "music",
    label: "音乐",
    instruction: "围绕歌曲、歌手、舞台、听歌偏好或现场氛围。"
  },
  {
    id: "game",
    label: "游戏",
    instruction: "围绕游戏作品、角色、版本、玩法、赛事或开黑体验。"
  },
  {
    id: "anime",
    label: "动漫",
    instruction: "围绕动画、漫画、角色、声优、名场面或追番体验。"
  },
  {
    id: "sports",
    label: "体育比赛",
    instruction: "围绕球赛、选手、队伍、观赛体验或运动话题。"
  }
] as const;

export type AiTimedBarrageTopicCategoryId = (typeof AI_TIMED_BARRAGE_TOPIC_CATEGORIES)[number]["id"];

export const AI_TIMED_BARRAGE_TOPIC_FRESHNESS = [
  {
    id: "evergreen",
    label: "普通话题",
    instruction: "选择常见、不过时、容易参与的轻松话题。"
  },
  {
    id: "hot",
    label: "近期热门",
    instruction:
      "必须围绕真实搜索到的近期热门作品、版本、赛事、舞台或梗；搜索结果不够明确时用开放式提问，不要断言未经搜索确认的细节。"
  }
] as const;

export type AiTimedBarrageTopicFreshnessId = (typeof AI_TIMED_BARRAGE_TOPIC_FRESHNESS)[number]["id"];

export interface AiTimedBarragePromptInput {
  styleId: AiTimedBarrageStyleId;
  intentId?: AiTimedBarrageIntentId;
  topicTargetId?: AiTimedBarrageTopicTargetId;
  topicCategoryId?: AiTimedBarrageTopicCategoryId;
  topicFreshnessId?: AiTimedBarrageTopicFreshnessId;
  mode: TimedBarrageMode;
  examples: string[];
  maxLength: number;
  webSearchRequired?: boolean;
}

export function resolveAiTimedBarrageIntent(intentId: string | undefined): (typeof AI_TIMED_BARRAGE_INTENTS)[number] {
  return AI_TIMED_BARRAGE_INTENTS.find((intent) => intent.id === intentId) ?? AI_TIMED_BARRAGE_INTENTS[0];
}

export function getAiTimedBarrageStyles(intentId: string | undefined) {
  const intent = resolveAiTimedBarrageIntent(intentId);
  if (intent.id === "chitchat_topic") return AI_TIMED_BARRAGE_CHITCHAT_STYLES;
  if (intent.id === "comfort") return AI_TIMED_BARRAGE_COMFORT_STYLES;
  return AI_TIMED_BARRAGE_REGULAR_STYLES;
}

export function resolveAiTimedBarrageStyle(styleId: string | undefined, intentId?: string) {
  const styles = getAiTimedBarrageStyles(intentId);
  return styles.find((style) => style.id === styleId) ?? styles[0];
}

function resolveAiTimedBarrageTopicTarget(
  topicTargetId: string | undefined
): (typeof AI_TIMED_BARRAGE_TOPIC_TARGETS)[number] {
  return AI_TIMED_BARRAGE_TOPIC_TARGETS.find((target) => target.id === topicTargetId) ?? AI_TIMED_BARRAGE_TOPIC_TARGETS[0];
}

function resolveAiTimedBarrageTopicCategory(
  topicCategoryId: string | undefined
): (typeof AI_TIMED_BARRAGE_TOPIC_CATEGORIES)[number] {
  return (
    AI_TIMED_BARRAGE_TOPIC_CATEGORIES.find((category) => category.id === topicCategoryId) ??
    AI_TIMED_BARRAGE_TOPIC_CATEGORIES[0]
  );
}

function resolveAiTimedBarrageTopicFreshness(
  topicFreshnessId: string | undefined
): (typeof AI_TIMED_BARRAGE_TOPIC_FRESHNESS)[number] {
  return (
    AI_TIMED_BARRAGE_TOPIC_FRESHNESS.find((freshness) => freshness.id === topicFreshnessId) ??
    AI_TIMED_BARRAGE_TOPIC_FRESHNESS[0]
  );
}

export function shouldUseAiTimedBarrageWebSearch(input: { intentId?: string; topicFreshnessId?: string }): boolean {
  return (
    resolveAiTimedBarrageIntent(input.intentId).id === "chitchat_topic" &&
    resolveAiTimedBarrageTopicFreshness(input.topicFreshnessId).id === "hot"
  );
}

export function createAiTimedBarrageMessages(input: AiTimedBarragePromptInput): Array<{ role: "system" | "user"; content: string }> {
  const intent = resolveAiTimedBarrageIntent(input.intentId);
  const style = resolveAiTimedBarrageStyle(input.styleId, intent.id);
  const topicTarget = resolveAiTimedBarrageTopicTarget(input.topicTargetId);
  const topicCategory = resolveAiTimedBarrageTopicCategory(input.topicCategoryId);
  const topicFreshness = resolveAiTimedBarrageTopicFreshness(input.topicFreshnessId);
  const requiresWebSearch = shouldUseAiTimedBarrageWebSearch({
    intentId: intent.id,
    topicFreshnessId: topicFreshness.id
  });
  const examples = input.examples.slice(0, 16);
  const exampleText = examples.length ? examples.map((text, index) => `${index + 1}. ${text}`).join("\n") : "暂无样例";
  const modeText = input.mode === "sequential" ? "顺序轮播" : "随机轮播";
  const webSearchLines =
    input.webSearchRequired && requiresWebSearch
      ? [
          "实时搜索要求：本次必须先调用 DeepSeek Web Search 搜索近期热点，再生成弹幕；最终只输出一句弹幕，不要带来源、链接、搜索过程。"
        ]
      : [];
  const comfortTargetInstruction =
    topicTarget.id === "host"
      ? "面向主播安慰，语气像在直播间里温柔撑一下场面，不替主播承诺结果。"
      : "面向观众安慰，语气照顾直播间整体情绪，帮助大家降温或打起精神。";
  const intentLines =
    intent.id === "chitchat_topic"
      ? [
          `生成目标：${intent.label}，${intent.instruction}`,
          `发起对象：${topicTarget.label}，${topicTarget.instruction}`,
          `话题方向：${topicCategory.label}，${topicCategory.instruction}`,
          `话题热度：${topicFreshness.label}，${topicFreshness.instruction}`,
          ...webSearchLines,
          "杂谈要求：输出一句容易接话的问题或选择题；不要像资讯播报；不要编造具体比分、赛果、发售日、更新日或新闻细节。"
        ]
      : intent.id === "comfort"
        ? [
            `生成目标：${intent.label}，${intent.instruction}`,
            `安慰对象：${topicTarget.label}，${comfortTargetInstruction}`,
            "安慰要求：先接住情绪，再给一点支持或缓和；不要说教、不要否定对方感受、不要提敏感私事；像房管在直播间里自然递一句话。"
          ]
      : [`生成目标：${intent.label}，${intent.instruction}`];
  const styleLineLabel =
    intent.id === "comfort" ? "安慰风格" : intent.id === "chitchat_topic" ? "话题风格" : "目标风格";

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
        `${styleLineLabel}：${style.label}，${style.instruction}`,
        ...intentLines,
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
