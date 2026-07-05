import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "../src/domain/defaultProfile";
import type { LiveStatusSnapshot } from "../src/domain/liveStatus";
import type { AssistantProfile, LiveEvent, PageAdapter, PageSendResult, TriggerSupport } from "../src/domain/types";
import { SidebarApp } from "../src/ui/SidebarApp";

const STORAGE_KEY = "assistantProfileV1";

const timings = {
  liveMonitorIntervalMs: 20,
  liveAutoTimedBarrageDurationMs: 200,
  liveAutoLikeDelayMs: 120,
  likeBurstIdleWaitMs: 10,
  likeBurstIdlePollMs: 5,
  countdownTickMs: 10
};

function createRoomManagerProfile(): AssistantProfile {
  const profile = createDefaultProfile();
  return {
    ...profile,
    rules: profile.rules.map((rule) =>
      rule.trigger === "gift" ? { ...rule, enabled: true, cooldownSeconds: 0 } : rule
    ),
    timedBarragePool: {
      ...profile.timedBarragePool,
      enabled: false,
      intervalSeconds: 30,
      mode: "sequential",
      items: [
        {
          id: "timed_barrage_test_call",
          label: "测试打call",
          text: "测试打call弹幕[打call]",
          enabled: true
        }
      ]
    },
    scheduledActions: profile.scheduledActions.map((action) =>
      action.kind === "like" ? { ...action, enabled: false, intervalSeconds: 1 } : action
    ),
    globalSendIntervalSeconds: 5
  };
}

function createGiftEvent(): LiveEvent {
  return {
    id: "event_gift_1",
    type: "gift",
    fingerprint: "event_gift_1",
    userName: "观众A",
    content: "送出 小心心 x1",
    giftName: "小心心",
    count: 1,
    giftDiamondCount: 1,
    giftTotalDiamondCount: 1,
    giftValueSource: "catalog-name",
    rawText: "观众A 送出 小心心 x1",
    timestamp: Date.now()
  };
}

function createMockAdapter(options?: { holdLikes?: boolean }) {
  let emitEvent: ((event: LiveEvent) => void) | undefined;
  const sentBarrages: string[] = [];
  const likeStarts: number[] = [];
  const likeResolvers: Array<(result: PageSendResult) => void> = [];

  const adapter: PageAdapter = {
    observeInteractionFeed(onEvent) {
      emitEvent = onEvent;
      return () => {
        emitEvent = undefined;
      };
    },
    async sendBarrage(text) {
      sentBarrages.push(text);
      return { ok: true };
    },
    async sendLike() {
      likeStarts.push(Date.now());
      if (options?.holdLikes) {
        return new Promise<PageSendResult>((resolve) => likeResolvers.push(resolve));
      }
      return { ok: true };
    },
    async cancelLike(): Promise<PageSendResult> {
      return { ok: true, cancelled: true };
    },
    getTriggerSupport(): TriggerSupport {
      return "supported";
    }
  };

  return {
    adapter,
    sentBarrages,
    likeStarts,
    resolveLikes(result: PageSendResult = { ok: true }) {
      while (likeResolvers.length) likeResolvers.shift()?.(result);
    },
    emitGift() {
      if (!emitEvent) throw new Error("interaction observer is not mounted");
      emitEvent(createGiftEvent());
    }
  };
}

async function mountSidebarApp(options: {
  adapter: PageAdapter;
  liveStatusChecker: () => Promise<LiveStatusSnapshot>;
  requestReload: () => void;
}): Promise<{ container: HTMLElement; unmount: () => void }> {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | undefined;

  await act(async () => {
    root = createRoot(container);
    root.render(
      <SidebarApp
        adapter={options.adapter}
        automationTimings={timings}
        liveStatusChecker={options.liveStatusChecker}
        requestReload={options.requestReload}
      />
    );
  });

  return {
    container,
    unmount() {
      if (root) {
        void act(() => {
          root?.unmount();
        });
      }
      container.remove();
    }
  };
}

async function settle(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
  }
}

function visibleText(): string {
  return document.body.textContent ?? "";
}

function clickButtonByText(pattern: RegExp): void {
  const button = Array.from(document.querySelectorAll("button")).find((element) =>
    pattern.test(element.textContent ?? "")
  );
  if (!button) throw new Error(`Button not found: ${pattern}`);

  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function changeSelectValue(selector: string, value: string): void {
  const select = document.querySelector<HTMLSelectElement>(selector);
  if (!select) throw new Error(`Select not found: ${selector}`);

  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function toggleLikeShortcut(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyL", altKey: true, shiftKey: true }));
  });
}

function installChromeRuntimeMessageStub(responseText: string): unknown[] {
  const messages: unknown[] = [];
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        sendMessage(message: unknown, callback: (response: unknown) => void) {
          messages.push(message);
          callback({ ok: true, text: responseText });
        }
      }
    }
  });
  return messages;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await settle();
}

describe("live room automation scenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T10:00:00.000Z"));
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createRoomManagerProfile()));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("auto-starts unattended live moderation and preserves the like countdown across switches", async () => {
    let liveStatus: LiveStatusSnapshot = { status: "live", source: "dom", detail: "test-live" };
    const checkLiveStatus = vi.fn(async () => liveStatus);
    const requestReload = vi.fn();
    const mock = createMockAdapter();

    const firstPage = await mountSidebarApp({
      adapter: mock.adapter,
      liveStatusChecker: checkLiveStatus,
      requestReload
    });
    await settle(12);

    expect(visibleText()).toContain("小光Ray房管助手");
    expect(visibleText()).toContain("托管模式");
    expect(visibleText()).toContain("已暂停");
    clickButtonByText(/定时/);
    await settle();
    expect(visibleText()).toContain("托管关");
    expect(requestReload).toHaveBeenCalledTimes(0);
    expect(mock.likeStarts).toHaveLength(0);
    expect(sessionStorage.getItem("dmwLiveAutoTimedBarragePending")).toBeNull();
    expect(sessionStorage.getItem("dmwLiveAutoLikePending")).toBeNull();

    await advance(timings.liveMonitorIntervalMs * 3);
    expect(requestReload).toHaveBeenCalledTimes(0);
    expect(mock.likeStarts).toHaveLength(0);
    expect(sessionStorage.getItem("dmwLiveAutoTimedBarragePending")).toBeNull();
    expect(sessionStorage.getItem("dmwLiveAutoLikePending")).toBeNull();

    clickButtonByText(/托管模式/);
    await advance(300);

    expect(requestReload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("dmwLiveAutoTimedBarragePending")).toBeTruthy();
    expect(sessionStorage.getItem("dmwLiveAutoLikePending")).toBeTruthy();

    firstPage.unmount();

    await mountSidebarApp({
      adapter: mock.adapter,
      liveStatusChecker: checkLiveStatus,
      requestReload
    });
    await settle(12);

    expect(visibleText()).toContain("运行中");
    expect(mock.likeStarts).toHaveLength(1);

    clickButtonByText(/定时/);
    const aiText = "小光这首太稳啦，大家一起点点赞[打call]";
    const aiMessages = installChromeRuntimeMessageStub(aiText);
    changeSelectValue(".dmw-ai-intent-select", "chitchat_topic");
    await settle();
    changeSelectValue(".dmw-ai-topic-target-select", "audience");
    changeSelectValue(".dmw-ai-topic-category-select", "game");
    changeSelectValue(".dmw-ai-topic-freshness-select", "hot");
    expect(visibleText()).toContain("DeepSeek Web Search");
    clickButtonByText(/刷新生成/);
    await settle(8);
    expect(aiMessages).toHaveLength(1);
    expect(aiMessages[0]).toMatchObject({
      type: "DMW_GENERATE_TIMED_BARRAGE",
      intentId: "chitchat_topic",
      topicTargetId: "audience",
      topicCategoryId: "game",
      topicFreshnessId: "hot",
      mode: "sequential"
    });
    expect(document.querySelector<HTMLTextAreaElement>(".dmw-ai-barrage-text")?.value).toBe(aiText);
    clickButtonByText(/立即发送/);
    await settle(8);
    expect(mock.sentBarrages).toContain(aiText);
    clickButtonByText(/加入弹幕池/);
    await settle();
    expect(Array.from(document.querySelectorAll("textarea")).some((textarea) => textarea.value === aiText)).toBe(true);

    toggleLikeShortcut();
    await settle();
    expect(visibleText()).toMatch(/已临时关闭，下一轮倒计时/);

    await advance(60);
    const readyAtBeforeManualRestart = sessionStorage.getItem("dmwLiveAutoLikeReadyAt");
    toggleLikeShortcut();
    await settle();
    expect(mock.likeStarts).toHaveLength(2);
    expect(sessionStorage.getItem("dmwLiveAutoLikeReadyAt")).toBe(readyAtBeforeManualRestart);

    await advance(80);
    expect(mock.likeStarts).toHaveLength(3);

    clickButtonByText(/暂停/);
    await settle();
    expect(visibleText()).toContain("已暂停");

    await advance(150);
    expect(mock.likeStarts).toHaveLength(3);
    expect(visibleText()).toMatch(/倒计时结束，等待总开关运行/);

    clickButtonByText(/开始/);
    await settle(8);
    expect(mock.likeStarts).toHaveLength(4);

    await advance(5_000);
    act(() => mock.emitGift());
    await advance(500);
    expect(mock.sentBarrages.some((text) => text.includes("感谢 观众A") && text.includes("小心心"))).toBe(true);

    await advance(30_000);
    await advance(500);
    await advance(500);
    expect(mock.sentBarrages).toContain("测试打call弹幕[打call]");
  }, 15_000);

  it("resets each hosted countdown and clears all countdowns when hosted mode is turned off", async () => {
    const now = Date.now();
    const profile = createRoomManagerProfile();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...profile,
        hostedModeEnabled: true,
        timedBarragePool: {
          ...profile.timedBarragePool,
          enabled: true
        }
      } satisfies AssistantProfile)
    );
    sessionStorage.setItem("dmwLiveAutoTimedBarrageHandled", "1");
    sessionStorage.setItem("dmwLiveAutoTimedBarrageExpiresAt", String(now + 10_000));
    sessionStorage.setItem("dmwLiveAutoLikeReadyAt", String(now + 5_000));
    sessionStorage.setItem("dmwLiveAutoLikeBurstUntil", String(now + 3_000));

    const checkLiveStatus = vi.fn(async (): Promise<LiveStatusSnapshot> => ({
      status: "unknown",
      source: "dom",
      detail: "test-unknown"
    }));
    const requestReload = vi.fn();
    const mock = createMockAdapter();

    await mountSidebarApp({
      adapter: mock.adapter,
      liveStatusChecker: checkLiveStatus,
      requestReload
    });
    await settle(12);

    clickButtonByText(/定时/);
    await settle();
    expect(visibleText()).toContain("重置窗口");
    expect(visibleText()).toContain("重置点赞");

    await advance(100);
    clickButtonByText(/重置窗口/);
    await settle();
    expect(Number(sessionStorage.getItem("dmwLiveAutoTimedBarrageExpiresAt"))).toBe(
      Date.now() + timings.liveAutoTimedBarrageDurationMs
    );

    await advance(100);
    clickButtonByText(/重置点赞/);
    await settle();
    expect(Number(sessionStorage.getItem("dmwLiveAutoLikeReadyAt"))).toBe(Date.now() + timings.liveAutoLikeDelayMs);
    expect(sessionStorage.getItem("dmwLiveAutoLikeBurstUntil")).toBeNull();

    clickButtonByText(/托管中/);
    await settle(8);

    expect(visibleText()).toContain("托管关");
    expect(sessionStorage.getItem("dmwLiveAutoTimedBarragePending")).toBeNull();
    expect(sessionStorage.getItem("dmwLiveAutoTimedBarrageExpiresAt")).toBeNull();
    expect(sessionStorage.getItem("dmwLiveAutoTimedBarrageHandled")).toBeNull();
    expect(sessionStorage.getItem("dmwLiveAutoLikePending")).toBeNull();
    expect(sessionStorage.getItem("dmwLiveAutoLikeReadyAt")).toBeNull();
    expect(sessionStorage.getItem("dmwLiveAutoLikeBurstUntil")).toBeNull();
  }, 15_000);

  it("resumes an active hosted like burst after a page refresh", async () => {
    const now = Date.now();
    const profile = createRoomManagerProfile();
    const hostedProfile: AssistantProfile = {
      ...profile,
      hostedModeEnabled: true,
      timedBarragePool: {
        ...profile.timedBarragePool,
        enabled: true
      },
      scheduledActions: profile.scheduledActions.map((action) =>
        action.kind === "like" ? { ...action, enabled: true, intervalSeconds: 1 } : action
      )
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hostedProfile));
    sessionStorage.setItem("dmwLiveAutoTimedBarrageHandled", "1");
    sessionStorage.setItem("dmwLiveAutoTimedBarrageExpiresAt", String(now + 10_000));
    sessionStorage.setItem("dmwLiveAutoLikeReadyAt", String(now));

    const checkLiveStatus = vi.fn(async (): Promise<LiveStatusSnapshot> => ({ status: "live", source: "dom", detail: "test-live" }));
    const requestReload = vi.fn();
    const mock = createMockAdapter({ holdLikes: true });

    const firstPage = await mountSidebarApp({
      adapter: mock.adapter,
      liveStatusChecker: checkLiveStatus,
      requestReload
    });
    await settle(16);

    expect(mock.likeStarts).toHaveLength(1);
    expect(Number(sessionStorage.getItem("dmwLiveAutoLikeBurstUntil"))).toBeGreaterThan(Date.now());

    firstPage.unmount();
    await advance(20);

    const secondPage = await mountSidebarApp({
      adapter: mock.adapter,
      liveStatusChecker: checkLiveStatus,
      requestReload
    });
    await settle(16);

    expect(mock.likeStarts).toHaveLength(2);

    mock.resolveLikes();
    await settle(8);
    secondPage.unmount();
  }, 15_000);
});
