import { describe, expect, it } from "vitest";
import {
  createAiTimedBarrageMessages,
  getAiTimedBarrageStyles,
  shouldUseAiTimedBarrageWebSearch
} from "../src/domain/aiTimedBarrage";

describe("AI timed barrage topic freshness", () => {
  it("uses web search only for hot chitchat topics", () => {
    expect(
      shouldUseAiTimedBarrageWebSearch({
        intentId: "chitchat_topic",
        topicFreshnessId: "hot"
      })
    ).toBe(true);

    expect(
      shouldUseAiTimedBarrageWebSearch({
        intentId: "regular",
        topicFreshnessId: "hot"
      })
    ).toBe(false);

    expect(
      shouldUseAiTimedBarrageWebSearch({
        intentId: "chitchat_topic",
        topicFreshnessId: "evergreen"
      })
    ).toBe(false);
  });

  it("adds a DeepSeek Web Search instruction when required", () => {
    const messages = createAiTimedBarrageMessages({
      styleId: "topic_light_question",
      intentId: "chitchat_topic",
      topicTargetId: "audience",
      topicCategoryId: "game",
      topicFreshnessId: "hot",
      mode: "sequential",
      examples: ["欢迎大家关注主播"],
      maxLength: 60,
      webSearchRequired: true
    });

    expect(messages.map((message) => message.content).join("\n")).toContain("DeepSeek Web Search");
  });

  it("uses separate style options for regular, chitchat, and comfort messages", () => {
    expect(getAiTimedBarrageStyles("regular").map((style) => style.id)).toContain("warm_call");
    expect(getAiTimedBarrageStyles("chitchat_topic").map((style) => style.id)).toContain("topic_light_question");
    expect(getAiTimedBarrageStyles("comfort").map((style) => style.id)).toContain("comfort_sad");
    expect(getAiTimedBarrageStyles("chitchat_topic").map((style) => style.id)).not.toContain("warm_call");
  });

  it("adds comfort-specific target and emotion instructions", () => {
    const messages = createAiTimedBarrageMessages({
      styleId: "comfort_sad",
      intentId: "comfort",
      topicTargetId: "host",
      mode: "sequential",
      examples: ["主播别难过，我们都在"],
      maxLength: 60
    });
    const prompt = messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("安慰风格：安慰伤心");
    expect(prompt).toContain("安慰对象：主播");
    expect(prompt).toContain("不要说教");
  });
});
