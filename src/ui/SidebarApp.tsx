import {
  Activity,
  ArrowDown,
  ArrowUp,
  Download,
  GripHorizontal,
  Heart,
  ListChecks,
  MessageSquare,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createDefaultProfile } from "../domain/defaultProfile";
import {
  AI_TIMED_BARRAGE_STYLES,
  cleanAiTimedBarrageText,
  type AiTimedBarrageStyleId
} from "../domain/aiTimedBarrage";
import { GIFT_REPLY_TIER_DEFINITIONS, resolveGiftReplyTemplate } from "../domain/giftReplyTiers";
import { createId } from "../domain/ids";
import { checkDouyinLiveStatus, type LiveStatus, type LiveStatusSnapshot } from "../domain/liveStatus";
import {
  liveEventLabels,
  logKindLabels,
  queueStatusLabels,
  supportLabels,
  triggerLabels
} from "../domain/labels";
import { canFireRule, giftRuleBlockReason, ruleMatchesEvent } from "../domain/rules";
import { checkSendGuard } from "../domain/sendGuard";
import { resolveReplyTemplate } from "../domain/templates";
import {
  AssistantProfile,
  AutomationRule,
  GiftReplyTier,
  LiveEvent,
  PageAdapter,
  ScheduledAction,
  SendQueueItem,
  SessionLogEntry,
  TimedBarrageItem,
  TimedBarrageMode,
  LiveEventType,
  TriggerType,
  TRIGGER_TYPES
} from "../domain/types";
import { loadProfile, normalizeProfile, saveProfile } from "../storage/profileStorage";

type TabKey = "rules" | "scheduled" | "logs";

type LiveMonitorStatus = "checking" | "live" | "offline" | "unknown";

interface GenerateTimedBarrageResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

interface SidebarAppProps {
  adapter: PageAdapter;
  automationTimings?: Partial<SidebarAutomationTimings>;
  liveStatusChecker?: () => Promise<LiveStatusSnapshot>;
  requestReload?: () => void;
}

interface SidebarAutomationTimings {
  liveMonitorIntervalMs: number;
  liveAutoTimedBarrageDurationMs: number;
  liveAutoLikeDelayMs: number;
  likeBurstIdleWaitMs: number;
  likeBurstIdlePollMs: number;
  countdownTickMs: number;
}

interface PanelBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PanelInteraction {
  kind: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startBounds: PanelBounds;
}

const PANEL_EDGE_PADDING = 8;
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_DEFAULT_HEIGHT = 640;
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 360;
const DEFAULT_AUTOMATION_TIMINGS: SidebarAutomationTimings = {
  liveMonitorIntervalMs: 30_000,
  liveAutoTimedBarrageDurationMs: 60 * 60 * 1000,
  liveAutoLikeDelayMs: 62 * 60 * 1000,
  likeBurstIdleWaitMs: 5000,
  likeBurstIdlePollMs: 250,
  countdownTickMs: 1000
};
const LIVE_AUTO_PENDING_KEY = "dmwLiveAutoTimedBarragePending";
const LIVE_AUTO_EXPIRES_KEY = "dmwLiveAutoTimedBarrageExpiresAt";
const LIVE_AUTO_HANDLED_KEY = "dmwLiveAutoTimedBarrageHandled";
const LIVE_AUTO_LIKE_PENDING_KEY = "dmwLiveAutoLikePending";
const LIVE_AUTO_LIKE_READY_KEY = "dmwLiveAutoLikeReadyAt";
const LIVE_AUTO_QUEUE_SOURCE_PREFIX = "开播定时弹幕";

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(timestamp);
}

function eventSummary(event: LiveEvent): string {
  if (event.type === "gift") {
    const countText = event.count ? ` x${event.count}` : "";
    const valueText =
      typeof event.giftTotalDiamondCount === "number"
        ? ` · ${event.giftTotalDiamondCount}钻`
        : event.giftDiamondCountOptions?.length
          ? ` · 价值待确认(${event.giftDiamondCountOptions.join("/")}钻)`
          : "";
    return `送出 ${event.giftName ?? "礼物"}${countText}${valueText}`;
  }
  if (event.type === "chat") return event.content;
  if (event.type === "system") return event.content || event.rawText;
  return event.content || liveEventLabels[event.type];
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clampPanelBounds(bounds: PanelBounds): PanelBounds {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(1, viewportWidth - PANEL_EDGE_PADDING * 2);
  const maxHeight = Math.max(1, viewportHeight - PANEL_EDGE_PADDING * 2);
  const width = clampNumber(bounds.width, Math.min(PANEL_MIN_WIDTH, maxWidth), maxWidth);
  const height = clampNumber(bounds.height, Math.min(PANEL_MIN_HEIGHT, maxHeight), maxHeight);
  const maxLeft = Math.max(PANEL_EDGE_PADDING, viewportWidth - width - PANEL_EDGE_PADDING);
  const maxTop = Math.max(PANEL_EDGE_PADDING, viewportHeight - height - PANEL_EDGE_PADDING);

  return {
    left: clampNumber(bounds.left, PANEL_EDGE_PADDING, maxLeft),
    top: clampNumber(bounds.top, PANEL_EDGE_PADDING, maxTop),
    width,
    height
  };
}

function createInitialPanelBounds(): PanelBounds {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(PANEL_DEFAULT_WIDTH, Math.max(1, viewportWidth - PANEL_EDGE_PADDING * 2));
  const height = Math.min(PANEL_DEFAULT_HEIGHT, Math.max(1, viewportHeight - PANEL_EDGE_PADDING * 2));

  return clampPanelBounds({
    left: viewportWidth - width - 16,
    top: 16,
    width,
    height
  });
}

function createLauncherStyle(bounds: PanelBounds): CSSProperties {
  return {
    left: clampNumber(bounds.left, PANEL_EDGE_PADDING, Math.max(PANEL_EDGE_PADDING, window.innerWidth - 150)),
    top: clampNumber(bounds.top, PANEL_EDGE_PADDING, Math.max(PANEL_EDGE_PADDING, window.innerHeight - 54))
  };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, label, a"));
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.isContentEditable || target.closest("input, select, textarea, [contenteditable='true']"));
}

function isGiftTrigger(trigger: TriggerType): boolean {
  return trigger === "gift" || trigger === "specificGift";
}

function giftTierTemplate(rule: AutomationRule, tierId: string): string {
  return rule.giftReplyTiers?.find((tier) => tier.id === tierId)?.replyTemplate ?? "";
}

function updateGiftTierTemplate(rule: AutomationRule, tierId: string, replyTemplate: string): GiftReplyTier[] {
  const templates = new Map(rule.giftReplyTiers?.map((tier) => [tier.id, tier.replyTemplate]));
  templates.set(tierId, replyTemplate);

  return GIFT_REPLY_TIER_DEFINITIONS.map((definition) => ({
    id: definition.id,
    replyTemplate: templates.get(definition.id) ?? ""
  }));
}

function pickRandomTimedBarrage(items: TimedBarrageItem[], previousItemId: string | undefined): TimedBarrageItem | undefined {
  if (items.length === 0) return undefined;
  const candidates = items.length > 1 ? items.filter((item) => item.id !== previousItemId) : items;
  const pool = candidates.length ? candidates : items;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickSequentialTimedBarrage(items: TimedBarrageItem[], previousItemId: string | undefined): TimedBarrageItem | undefined {
  if (items.length === 0) return undefined;
  const previousIndex = previousItemId ? items.findIndex((item) => item.id === previousItemId) : -1;
  return items[(previousIndex + 1) % items.length];
}

function readLiveAutoTimedBarrageExpiresAt(): number | undefined {
  const raw = window.sessionStorage.getItem(LIVE_AUTO_EXPIRES_KEY);
  const value = raw ? Number(raw) : undefined;
  return value && value > Date.now() ? value : undefined;
}

function readLiveAutoLikeReadyAt(): number | undefined {
  const raw = window.sessionStorage.getItem(LIVE_AUTO_LIKE_READY_KEY);
  const value = raw ? Number(raw) : undefined;
  return value && value > 0 ? value : undefined;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function liveMonitorLabel(status: LiveMonitorStatus): string {
  if (status === "live") return "已开播";
  if (status === "offline") return "未开播";
  if (status === "checking") return "检测中";
  return "未知";
}

function chromeRuntimeSendMessage<TResponse>(message: unknown): Promise<TResponse | undefined> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      resolve(undefined);
      return;
    }

    chrome.runtime.sendMessage(message, (response: TResponse | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

function isLiveAutoTimedBarrageQueueItem(item: SendQueueItem): boolean {
  return item.source.startsWith(LIVE_AUTO_QUEUE_SOURCE_PREFIX);
}

function isTimedBarrageQueueItem(item: SendQueueItem): boolean {
  return (
    isLiveAutoTimedBarrageQueueItem(item) ||
    item.source.startsWith("定时弹幕随机：") ||
    item.source.startsWith("定时弹幕顺序：") ||
    item.source.startsWith("定时弹幕：")
  );
}

export function SidebarApp({
  adapter,
  automationTimings,
  liveStatusChecker = checkDouyinLiveStatus,
  requestReload = () => window.location.reload()
}: SidebarAppProps) {
  const [visible, setVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("rules");
  const [panelBounds, setPanelBounds] = useState<PanelBounds>(() => createInitialPanelBounds());
  const [profile, setProfile] = useState<AssistantProfile>(() => createDefaultProfile());
  const [profileReady, setProfileReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const [queue, setQueue] = useState<SendQueueItem[]>([]);
  const [hideMemberLogEvents, setHideMemberLogEvents] = useState(true);
  const [hideLikeLogEvents, setHideLikeLogEvents] = useState(true);
  const [liveMonitorStatus, setLiveMonitorStatus] = useState<LiveMonitorStatus>("checking");
  const [liveAutoTimedBarrageExpiresAt, setLiveAutoTimedBarrageExpiresAt] = useState<number | undefined>(
    readLiveAutoTimedBarrageExpiresAt
  );
  const [liveAutoLikeReadyAt, setLiveAutoLikeReadyAt] = useState<number | undefined>(readLiveAutoLikeReadyAt);
  const [liveAutoCountdownNow, setLiveAutoCountdownNow] = useState(Date.now());
  const [aiTimedBarrageStyleId, setAiTimedBarrageStyleId] = useState<AiTimedBarrageStyleId>("warm_call");
  const [aiTimedBarrageText, setAiTimedBarrageText] = useState("");
  const [aiTimedBarrageError, setAiTimedBarrageError] = useState<string | undefined>(undefined);
  const [aiTimedBarrageLoading, setAiTimedBarrageLoading] = useState(false);
  const timings = useMemo<SidebarAutomationTimings>(
    () => ({ ...DEFAULT_AUTOMATION_TIMINGS, ...automationTimings }),
    [automationTimings]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef(profile);
  const runningRef = useRef(running);
  const queueRef = useRef(queue);
  const lastRuleFiredRef = useRef(new Map<string, number>());
  const lastBarrageAtRef = useRef(0);
  const lastSentTextRef = useRef<string | undefined>(undefined);
  const lastTimedBarrageItemRef = useRef<string | undefined>(undefined);
  const processingRef = useRef(false);
  const likeBurstStartedRef = useRef(false);
  const panelBoundsRef = useRef(panelBounds);
  const panelInteractionRef = useRef<PanelInteraction | null>(null);
  const bodyCursorRef = useRef("");
  const bodyUserSelectRef = useRef("");
  const lastLiveStatusRef = useRef<LiveStatus | undefined>(undefined);
  const liveAutoTimedBarrageActiveRef = useRef(false);

  const liveAutoTimedBarrageActive = Boolean(
    liveAutoTimedBarrageExpiresAt && liveAutoTimedBarrageExpiresAt > liveAutoCountdownNow
  );
  const liveAutoTimedBarrageRemainingMs =
    liveAutoTimedBarrageActive && liveAutoTimedBarrageExpiresAt
      ? Math.max(0, liveAutoTimedBarrageExpiresAt - liveAutoCountdownNow)
      : 0;
  const liveAutoLikeWaiting = Boolean(liveAutoLikeReadyAt && liveAutoLikeReadyAt > liveAutoCountdownNow);
  const liveAutoLikeRemainingMs =
    liveAutoLikeWaiting && liveAutoLikeReadyAt ? Math.max(0, liveAutoLikeReadyAt - liveAutoCountdownNow) : 0;
  const liveMonitorSupportTone = !profile.hostedModeEnabled
    ? "pending"
    : liveMonitorStatus === "live"
      ? "supported"
      : liveMonitorStatus === "offline"
        ? "pending"
        : "partial";

  useEffect(() => {
    panelBoundsRef.current = panelBounds;
  }, [panelBounds]);

  const handlePanelPointerMove = useCallback((event: PointerEvent) => {
    const interaction = panelInteractionRef.current;
    if (!interaction) return;

    const deltaX = event.clientX - interaction.startClientX;
    const deltaY = event.clientY - interaction.startClientY;
    if (interaction.kind === "move") {
      setPanelBounds(
        clampPanelBounds({
          ...interaction.startBounds,
          left: interaction.startBounds.left + deltaX,
          top: interaction.startBounds.top + deltaY
        })
      );
      return;
    }

    setPanelBounds(
      clampPanelBounds({
        ...interaction.startBounds,
        width: interaction.startBounds.width + deltaX,
        height: interaction.startBounds.height + deltaY
      })
    );
  }, []);

  const stopPanelInteraction = useCallback(() => {
    panelInteractionRef.current = null;
    document.body.style.cursor = bodyCursorRef.current;
    document.body.style.userSelect = bodyUserSelectRef.current;
    window.removeEventListener("pointermove", handlePanelPointerMove);
    window.removeEventListener("pointerup", stopPanelInteraction);
    window.removeEventListener("pointercancel", stopPanelInteraction);
  }, [handlePanelPointerMove]);

  const beginPanelInteraction = useCallback(
    (kind: PanelInteraction["kind"], event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (kind === "move" && isInteractiveTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      if (panelInteractionRef.current) stopPanelInteraction();

      bodyCursorRef.current = document.body.style.cursor;
      bodyUserSelectRef.current = document.body.style.userSelect;
      document.body.style.cursor = kind === "move" ? "move" : "nwse-resize";
      document.body.style.userSelect = "none";
      panelInteractionRef.current = {
        kind,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startBounds: panelBoundsRef.current
      };
      window.addEventListener("pointermove", handlePanelPointerMove);
      window.addEventListener("pointerup", stopPanelInteraction, { once: true });
      window.addEventListener("pointercancel", stopPanelInteraction, { once: true });
    },
    [handlePanelPointerMove, stopPanelInteraction]
  );

  useEffect(() => {
    const handleWindowResize = () => setPanelBounds((current) => clampPanelBounds(current));
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    return () => {
      if (!panelInteractionRef.current) return;
      stopPanelInteraction();
    };
  }, [stopPanelInteraction]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const appendLog = useCallback(
    (kind: SessionLogEntry["kind"], message: string, userName = "系统", eventType?: LiveEventType) => {
    setLogs((current) => [
      { id: createId("log"), kind, eventType, userName: userName || "系统", message, timestamp: Date.now() },
      ...current
    ].slice(0, 240));
    },
    []
  );

  const updateProfile = useCallback((updater: (current: AssistantProfile) => AssistantProfile) => {
    setProfile((current) => ({ ...updater(current), updatedAt: Date.now() }));
  }, []);

  const updateScheduledLikeEnabled = useCallback(
    (enabled: boolean) => {
      updateProfile((current) => ({
        ...current,
        scheduledActions: current.scheduledActions.map((action) =>
          action.kind === "like" ? ({ ...action, enabled } as ScheduledAction) : action
        )
      }));
    },
    [updateProfile]
  );

  const startLiveAutoLikeCountdown = useCallback(
    (readyAt: number, reason: string, shouldLog = true) => {
      window.sessionStorage.setItem(LIVE_AUTO_LIKE_READY_KEY, String(readyAt));
      setLiveAutoLikeReadyAt(readyAt);
      setLiveAutoCountdownNow(Date.now());
      likeBurstStartedRef.current = false;
      updateScheduledLikeEnabled(true);
      if (shouldLog) {
        const remainingMs = readyAt - Date.now();
        const timingText =
          remainingMs <= 0 ? "将立即执行，并开始 62 分钟倒计时" : `下一轮将在 ${formatDuration(remainingMs)} 后执行`;
        appendLog("assistant", `自动点赞已打开，${timingText}：${reason}`);
      }
    },
    [appendLog, updateScheduledLikeEnabled]
  );

  const stopLiveAutoLikeCountdown = useCallback(
    (message: string, options?: { shouldDisableLike?: boolean; shouldClearSchedule?: boolean }) => {
      const hadAutoLike = Boolean(
        window.sessionStorage.getItem(LIVE_AUTO_LIKE_PENDING_KEY) ||
          window.sessionStorage.getItem(LIVE_AUTO_LIKE_READY_KEY)
      );
      window.sessionStorage.removeItem(LIVE_AUTO_LIKE_PENDING_KEY);
      if (options?.shouldClearSchedule) {
        window.sessionStorage.removeItem(LIVE_AUTO_LIKE_READY_KEY);
        setLiveAutoLikeReadyAt(undefined);
      } else {
        setLiveAutoLikeReadyAt(readLiveAutoLikeReadyAt());
      }
      setLiveAutoCountdownNow(Date.now());
      likeBurstStartedRef.current = false;
      void adapter.cancelLike?.();
      if (options?.shouldDisableLike) updateScheduledLikeEnabled(false);
      if (hadAutoLike) appendLog("assistant", message);
    },
    [adapter, appendLog, updateScheduledLikeEnabled]
  );

  const toggleLiveAutoLike = useCallback(
    (reason: string) => {
      const isEnabled = profileRef.current.scheduledActions.some((action) => action.kind === "like" && action.enabled);
      if (isEnabled) {
        stopLiveAutoLikeCountdown(`自动点赞已关闭：${reason}`, { shouldDisableLike: true });
        return;
      }

      const existingReadyAt = readLiveAutoLikeReadyAt();
      if (existingReadyAt) {
        setLiveAutoLikeReadyAt(existingReadyAt);
        setLiveAutoCountdownNow(Date.now());
        updateScheduledLikeEnabled(true);
        appendLog("assistant", `自动点赞已开启，继续当前 62 分钟倒计时：${reason}`);
        return;
      }

      startLiveAutoLikeCountdown(Date.now(), reason);
    },
    [appendLog, startLiveAutoLikeCountdown, stopLiveAutoLikeCountdown, updateScheduledLikeEnabled]
  );

  const enableLiveAutomationControls = useCallback(
    (reason: string, shouldLog = false) => {
      setRunning(true);
      updateProfile((current) => ({
        ...current,
        timedBarragePool: {
          ...current.timedBarragePool,
          enabled: true
        }
      }));
      if (shouldLog) appendLog("assistant", `已开启房管总开关和定时弹幕池：${reason}`);
    },
    [appendLog, updateProfile]
  );

  const disableLiveAutomationControls = useCallback(
    (reason: string, shouldLog = false) => {
      setRunning(false);
      updateProfile((current) => ({
        ...current,
        timedBarragePool: {
          ...current.timedBarragePool,
          enabled: false
        }
      }));
      if (shouldLog) appendLog("assistant", `已关闭房管总开关和定时弹幕池：${reason}`);
    },
    [appendLog, updateProfile]
  );

  const startLiveAutoTimedBarrage = useCallback(
    (reason: string, shouldRefresh: boolean) => {
      const now = Date.now();
      const expiresAt = now + timings.liveAutoTimedBarrageDurationMs;
      const likeReadyAt = now;
      window.sessionStorage.setItem(LIVE_AUTO_HANDLED_KEY, "1");
      window.sessionStorage.setItem(LIVE_AUTO_EXPIRES_KEY, String(expiresAt));
      setLiveAutoTimedBarrageExpiresAt(expiresAt);
      setLiveAutoCountdownNow(now);

      if (shouldRefresh) {
        window.sessionStorage.setItem(LIVE_AUTO_PENDING_KEY, String(expiresAt));
        window.sessionStorage.setItem(LIVE_AUTO_LIKE_PENDING_KEY, String(likeReadyAt));
        requestReload();
        return;
      }

      enableLiveAutomationControls(reason, true);
      startLiveAutoLikeCountdown(likeReadyAt, reason);
      appendLog("assistant", `检测到直播开播，已记录开播窗口：${reason}`);
    },
    [appendLog, enableLiveAutomationControls, requestReload, startLiveAutoLikeCountdown, timings.liveAutoTimedBarrageDurationMs]
  );

  const renewLiveAutoTimedBarrage = useCallback(() => {
    const expiresAt = Date.now() + timings.liveAutoTimedBarrageDurationMs;
    window.sessionStorage.setItem(LIVE_AUTO_HANDLED_KEY, "1");
    window.sessionStorage.setItem(LIVE_AUTO_EXPIRES_KEY, String(expiresAt));
    setLiveAutoTimedBarrageExpiresAt(expiresAt);
    liveAutoTimedBarrageActiveRef.current = true;
  }, [timings.liveAutoTimedBarrageDurationMs]);

  const clearPendingLiveAutoTimedBarrageQueue = useCallback(() => {
    setQueue((current) =>
      current.filter((item) => !(item.status === "pending" && isLiveAutoTimedBarrageQueueItem(item)))
    );
  }, []);

  const clearPendingTimedBarrageQueue = useCallback(() => {
    setQueue((current) => current.filter((item) => !(item.status === "pending" && isTimedBarrageQueueItem(item))));
  }, []);

  const stopLiveAutoTimedBarrage = useCallback(
    (message: string) => {
      const hadAutoWindow = Boolean(
        liveAutoTimedBarrageActiveRef.current ||
          window.sessionStorage.getItem(LIVE_AUTO_EXPIRES_KEY) ||
          window.sessionStorage.getItem(LIVE_AUTO_PENDING_KEY)
      );
      window.sessionStorage.removeItem(LIVE_AUTO_PENDING_KEY);
      window.sessionStorage.removeItem(LIVE_AUTO_EXPIRES_KEY);
      setLiveAutoTimedBarrageExpiresAt(undefined);
      setLiveAutoCountdownNow(Date.now());
      liveAutoTimedBarrageActiveRef.current = false;
      clearPendingLiveAutoTimedBarrageQueue();
      if (hadAutoWindow) appendLog("assistant", message);
    },
    [appendLog, clearPendingLiveAutoTimedBarrageQueue]
  );

  const clearHostedPendingState = useCallback(
    () => {
      window.sessionStorage.removeItem(LIVE_AUTO_PENDING_KEY);
      window.sessionStorage.removeItem(LIVE_AUTO_EXPIRES_KEY);
      window.sessionStorage.removeItem(LIVE_AUTO_HANDLED_KEY);
      window.sessionStorage.removeItem(LIVE_AUTO_LIKE_PENDING_KEY);
      setLiveAutoTimedBarrageExpiresAt(undefined);
      liveAutoTimedBarrageActiveRef.current = false;
      clearPendingLiveAutoTimedBarrageQueue();
    },
    [clearPendingLiveAutoTimedBarrageQueue]
  );

  const clearHostedLiveAutomationState = useCallback(
    (message?: string) => {
      clearHostedPendingState();
      disableLiveAutomationControls(message ?? "托管模式已关闭", false);
      stopLiveAutoLikeCountdown(message ?? "托管模式已关闭，已取消开播自动功能", {
        shouldDisableLike: true,
        shouldClearSchedule: true
      });
      if (message) appendLog("assistant", message);
    },
    [appendLog, clearHostedPendingState, disableLiveAutomationControls, stopLiveAutoLikeCountdown]
  );

  const toggleHostedMode = useCallback(() => {
    const nextEnabled = !profileRef.current.hostedModeEnabled;
    const nextProfile = {
      ...profileRef.current,
      hostedModeEnabled: nextEnabled,
      updatedAt: Date.now()
    };

    profileRef.current = nextProfile;
    setProfile(nextProfile);
    void saveProfile(nextProfile);

    if (nextEnabled) {
      appendLog("assistant", "托管模式已开启，开播检测将允许自动刷新并启动房管功能");
      return;
    }

    clearHostedLiveAutomationState("托管模式已关闭，已停止开播自动功能");
  }, [appendLog, clearHostedLiveAutomationState]);

  useEffect(() => {
    let cancelled = false;
    loadProfile().then((loadedProfile) => {
      if (cancelled) return;
      setProfile(loadedProfile);
      setProfileReady(true);
      appendLog("assistant", "已加载本地配置");
    });
    return () => {
      cancelled = true;
    };
  }, [appendLog]);

  useEffect(() => {
    if (!profileReady) return;
    const timer = window.setTimeout(() => {
      void saveProfile(profile);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [profile, profileReady]);

  useEffect(() => {
    const timer = window.setInterval(() => setLiveAutoCountdownNow(Date.now()), timings.countdownTickMs);
    return () => window.clearInterval(timer);
  }, [timings.countdownTickMs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isEditableShortcutTarget(event.target)) return;
      if (!(event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyL")) return;

      event.preventDefault();
      event.stopPropagation();
      toggleLiveAutoLike("快捷键 Alt+Shift+L");
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [toggleLiveAutoLike]);

  useEffect(() => {
    const likeAction = profile.scheduledActions.find((action) => action.kind === "like" && action.enabled);
    if (!likeAction || liveAutoLikeReadyAt) return;
    startLiveAutoLikeCountdown(Date.now(), "自动点赞开关已开启");
  }, [liveAutoLikeReadyAt, profile.scheduledActions, startLiveAutoLikeCountdown]);

  useEffect(() => {
    if (!liveAutoLikeReadyAt || liveAutoLikeWaiting) return;
    const likeEnabled = profile.scheduledActions.some((action) => action.kind === "like" && action.enabled);
    if (likeEnabled) return;

    updateScheduledLikeEnabled(true);
    appendLog("assistant", "自动点赞倒计时结束，已自动开启自动点赞");
  }, [appendLog, liveAutoLikeReadyAt, liveAutoLikeWaiting, profile.scheduledActions, updateScheduledLikeEnabled]);

  useEffect(() => {
    if (!profileReady) return;
    if (!profile.hostedModeEnabled) {
      if (window.sessionStorage.getItem(LIVE_AUTO_PENDING_KEY) || window.sessionStorage.getItem(LIVE_AUTO_LIKE_PENDING_KEY)) {
        clearHostedPendingState();
      }
      return;
    }

    const now = Date.now();
    const pendingTimedBarrage = Number(window.sessionStorage.getItem(LIVE_AUTO_PENDING_KEY) || "");
    const pendingLike = Number(window.sessionStorage.getItem(LIVE_AUTO_LIKE_PENDING_KEY) || "");

    if (pendingTimedBarrage) {
      window.sessionStorage.removeItem(LIVE_AUTO_PENDING_KEY);
      if (pendingTimedBarrage > now) {
        window.sessionStorage.setItem(LIVE_AUTO_HANDLED_KEY, "1");
        window.sessionStorage.setItem(LIVE_AUTO_EXPIRES_KEY, String(pendingTimedBarrage));
        setLiveAutoTimedBarrageExpiresAt(pendingTimedBarrage);
        setLiveAutoCountdownNow(now);
        enableLiveAutomationControls("开播刷新完成", true);
        appendLog("assistant", "开播刷新完成，已记录开播窗口");
      }
    }

    if (!pendingLike) return;
    window.sessionStorage.removeItem(LIVE_AUTO_LIKE_PENDING_KEY);
    startLiveAutoLikeCountdown(pendingLike, "开播刷新完成");
  }, [
    appendLog,
    clearHostedPendingState,
    enableLiveAutomationControls,
    profile.hostedModeEnabled,
    profileReady,
    startLiveAutoLikeCountdown
  ]);

  useEffect(() => {
    liveAutoTimedBarrageActiveRef.current = liveAutoTimedBarrageActive;
    if (liveAutoTimedBarrageActive || liveAutoTimedBarrageExpiresAt === undefined) return;

    window.sessionStorage.removeItem(LIVE_AUTO_EXPIRES_KEY);
    setLiveAutoTimedBarrageExpiresAt(undefined);
    updateProfile((current) => ({
      ...current,
      timedBarragePool: {
        ...current.timedBarragePool,
        enabled: false
      }
    }));
    clearPendingTimedBarrageQueue();
    appendLog("assistant", "1 小时开播窗口已结束，已清理未发送的定时弹幕");
  }, [
    appendLog,
    clearPendingTimedBarrageQueue,
    liveAutoTimedBarrageActive,
    liveAutoTimedBarrageExpiresAt,
    updateProfile
  ]);

  useEffect(() => {
    if (!profileReady) return;
    let disposed = false;
    let checking = false;

    const runCheck = async () => {
      if (checking) return;
      checking = true;
      setLiveMonitorStatus("checking");

      const snapshot = await liveStatusChecker();
      checking = false;
      if (disposed) return;

      setLiveMonitorStatus(snapshot.status);
      const previousStatus = lastLiveStatusRef.current;
      lastLiveStatusRef.current = snapshot.status;
      const hostedModeEnabled = profileRef.current.hostedModeEnabled;

      if (!hostedModeEnabled) {
        clearHostedPendingState();
        return;
      }

      if (snapshot.status === "offline") {
        window.sessionStorage.removeItem(LIVE_AUTO_HANDLED_KEY);
        disableLiveAutomationControls("检测到直播未开播", true);
        stopLiveAutoTimedBarrage("检测到直播未开播，已关闭开播定时弹幕窗口");
        stopLiveAutoLikeCountdown("检测到直播未开播，已关闭自动点赞", {
          shouldDisableLike: true,
          shouldClearSchedule: true
        });
        return;
      }

      if (snapshot.status !== "live") return;

      const hasHandledCurrentLive = window.sessionStorage.getItem(LIVE_AUTO_HANDLED_KEY) === "1";
      const reason = snapshot.detail ?? snapshot.source;
      if (previousStatus === "offline") {
        startLiveAutoTimedBarrage(reason, true);
        return;
      }

      if (!hasHandledCurrentLive && !liveAutoTimedBarrageActiveRef.current) {
        startLiveAutoTimedBarrage(reason, true);
        return;
      }

      renewLiveAutoTimedBarrage();
    };

    void runCheck();
    const timer = window.setInterval(() => void runCheck(), timings.liveMonitorIntervalMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    clearHostedPendingState,
    disableLiveAutomationControls,
    liveStatusChecker,
    profileReady,
    renewLiveAutoTimedBarrage,
    startLiveAutoTimedBarrage,
    stopLiveAutoLikeCountdown,
    stopLiveAutoTimedBarrage,
    timings.liveMonitorIntervalMs
  ]);

  const enqueueBarrage = useCallback(
    (text: string, source: string, eventId?: string, options?: { allowRepeat?: boolean }) => {
      const item: SendQueueItem = {
        id: createId("queue"),
        text,
        source,
        eventId,
        allowRepeat: options?.allowRepeat,
        status: "pending",
        createdAt: Date.now()
      };
      setQueue((current) => [...current, item].slice(-120));
      appendLog("assistant", `已加入发送队列：${source}`);
    },
    [appendLog]
  );

  useEffect(() => {
    const stop = adapter.observeInteractionFeed((event) => {
      setEvents((current) => [event, ...current].slice(0, 160));
      appendLog("event", eventSummary(event), event.userName || "系统", event.type);

      const currentProfile = profileRef.current;
      if (!runningRef.current) {
        if (event.type === "gift") {
          for (const rule of currentProfile.rules) {
            const blockReason = giftRuleBlockReason(rule, event);
            if (blockReason) {
              appendLog("warning", `预检规则「${rule.name}」未触发：${blockReason}`, event.userName, event.type);
              continue;
            }
            if (ruleMatchesEvent(rule, event)) {
              appendLog("assistant", `预检规则「${rule.name}」会触发，助手已暂停，未加入发送队列`, event.userName, event.type);
            }
          }
        }
        return;
      }

      const now = Date.now();
      for (const rule of currentProfile.rules) {
        const blockReason = giftRuleBlockReason(rule, event);
        if (!ruleMatchesEvent(rule, event)) {
          if (blockReason) appendLog("warning", `规则「${rule.name}」未触发：${blockReason}`, event.userName, event.type);
          continue;
        }
        const support = adapter.getTriggerSupport(rule.trigger);
        if (support === "pending") {
          appendLog("warning", `规则「${rule.name}」的触发条件暂未适配当前页面`);
          continue;
        }
        if (!canFireRule(rule, lastRuleFiredRef.current.get(rule.id), now)) continue;
        lastRuleFiredRef.current.set(rule.id, now);
        enqueueBarrage(resolveReplyTemplate(resolveGiftReplyTemplate(rule, event), event), `规则：${rule.name}`, event.id);
      }
    });

    return stop;
  }, [adapter, appendLog, enqueueBarrage]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (!runningRef.current || processingRef.current) return;
      const currentProfile = profileRef.current;
      if (Date.now() - lastBarrageAtRef.current < currentProfile.globalSendIntervalSeconds * 1000) return;

      const next = queueRef.current.find((item) => {
        if (item.status !== "pending") return false;
        if (isTimedBarrageQueueItem(item)) return runningRef.current && currentProfile.timedBarragePool.enabled;
        return runningRef.current;
      });
      if (!next) return;

      processingRef.current = true;
      setQueue((current) => current.map((item) => (item.id === next.id ? { ...item, status: "sending" } : item)));

      const guard = checkSendGuard({
        text: next.text,
        maxLength: currentProfile.maxReplyLength,
        lastSentText: lastSentTextRef.current,
        allowRepeat: next.allowRepeat
      });

      if (!guard.ok) {
        setQueue((current) =>
          current.map((item) =>
            item.id === next.id ? { ...item, status: "blocked", error: guard.reason } : item
          )
        );
        appendLog("warning", `发送拦截：${guard.reason}`);
        processingRef.current = false;
        return;
      }

      const result = await adapter.sendBarrage(guard.text, {
        verifyInputWrite: currentProfile.verifyBarrageInputBeforeSend
      });
      if (result.ok) {
        lastBarrageAtRef.current = Date.now();
        lastSentTextRef.current = guard.text;
        setQueue((current) => current.filter((item) => item.id !== next.id));
        appendLog("send", `已发送弹幕：${guard.text}`);
      } else {
        setQueue((current) =>
          current.map((item) =>
            item.id === next.id ? { ...item, status: "failed", error: result.error ?? "发送失败" } : item
          )
        );
        appendLog("error", `弹幕发送失败：${result.error ?? "未知错误"}`);
      }

      processingRef.current = false;
    }, 500);

    return () => window.clearInterval(timer);
  }, [adapter, appendLog]);

  useEffect(() => {
    if (!running || !profile.timedBarragePool.enabled) return;

    const timers: number[] = [];
    const pool = profile.timedBarragePool;

    if (pool.enabled) {
      const intervalSeconds = Math.max(30, pool.intervalSeconds);
      timers.push(
        window.setInterval(() => {
          if (!runningRef.current) return;
          const currentPool = profileRef.current.timedBarragePool;
          if (!currentPool.enabled) return;
          const items = currentPool.items.filter((item) => item.enabled && item.text.trim());
          const next =
            currentPool.mode === "sequential"
              ? pickSequentialTimedBarrage(items, lastTimedBarrageItemRef.current)
              : pickRandomTimedBarrage(items, lastTimedBarrageItemRef.current);
          if (!next) return;

          lastTimedBarrageItemRef.current = next.id;
          enqueueBarrage(
            next.text,
            currentPool.mode === "sequential" ? `定时弹幕顺序：${next.label}` : `定时弹幕随机：${next.label}`,
            undefined,
            { allowRepeat: true }
          );
        }, intervalSeconds * 1000)
      );
    }

    return () => timers.forEach((timer) => window.clearInterval(timer));
  }, [adapter, appendLog, enqueueBarrage, liveAutoTimedBarrageActive, profile.scheduledActions, profile.timedBarragePool, running]);

  useEffect(() => {
    const likeEnabled = profile.scheduledActions.some((action) => action.kind === "like" && action.enabled);
    if (running && likeEnabled) return;
    void adapter.cancelLike?.();
  }, [adapter, profile.scheduledActions, running]);

  useEffect(() => {
    const likeAction = profile.scheduledActions.find((action) => action.kind === "like" && action.enabled);
    if (!running || !likeAction) {
      likeBurstStartedRef.current = false;
      return;
    }

    if (liveAutoLikeWaiting) {
      likeBurstStartedRef.current = false;
      return;
    }

    if (!liveAutoLikeReadyAt) return;

    if (likeBurstStartedRef.current) return;

    let cancelled = false;
    likeBurstStartedRef.current = true;

    const runLikeBurst = async () => {
      const durationSeconds = clampNumber(likeAction.intervalSeconds, 1, 400);
      const isLikeEnabled = () =>
        runningRef.current &&
        profileRef.current.scheduledActions.some((action) => action.kind === "like" && action.enabled);
      const hasBarrageWork = () =>
        processingRef.current || queueRef.current.some((item) => item.status === "pending" || item.status === "sending");
      const scheduleNextRun = (delayMs: number) => {
        const nextReadyAt = Date.now() + delayMs;
        window.sessionStorage.setItem(LIVE_AUTO_LIKE_READY_KEY, String(nextReadyAt));
        setLiveAutoLikeReadyAt(nextReadyAt);
        setLiveAutoCountdownNow(Date.now());
        return nextReadyAt;
      };
      const idleDeadline = Date.now() + timings.likeBurstIdleWaitMs;
      while (!cancelled && hasBarrageWork() && Date.now() < idleDeadline) {
        await wait(timings.likeBurstIdlePollMs);
      }

      if (cancelled || !isLikeEnabled()) return;
      if (hasBarrageWork()) {
        scheduleNextRun(timings.likeBurstIdleWaitMs);
        likeBurstStartedRef.current = false;
        appendLog("warning", "自动点赞暂缓：弹幕队列正忙，稍后重试");
        return;
      }

      const nextReadyAt = scheduleNextRun(timings.liveAutoLikeDelayMs);
      appendLog("assistant", `自动点赞已开始，下一轮将在 ${formatDuration(nextReadyAt - Date.now())} 后执行`);
      processingRef.current = true;
      try {
        const result = await adapter.sendLike({ durationSeconds });
        if (result.cancelled || !isLikeEnabled()) return;
        if (result.ok) appendLog("send", `已执行 ${durationSeconds} 秒连续点赞`);
        else appendLog("error", `自动点赞失败：${result.error ?? "未知错误"}`);
      } catch (error) {
        appendLog("error", `自动点赞异常：${error instanceof Error ? error.message : "未知错误"}`);
      } finally {
        likeBurstStartedRef.current = false;
        processingRef.current = false;
      }
    };

    void runLikeBurst();
    return () => {
      cancelled = true;
    };
  }, [
    adapter,
    appendLog,
    liveAutoLikeReadyAt,
    liveAutoLikeWaiting,
    profile.scheduledActions,
    running,
    timings.likeBurstIdlePollMs,
    timings.likeBurstIdleWaitMs,
    timings.liveAutoLikeDelayMs
  ]);

  const enabledRuleCount = useMemo(() => profile.rules.filter((rule) => rule.enabled).length, [profile.rules]);
  const pendingQueueCount = useMemo(() => queue.filter((item) => item.status === "pending").length, [queue]);
  const visibleLogs = useMemo(() => {
    return logs.filter((entry) => {
      if (hideMemberLogEvents && entry.eventType === "member") return false;
      if (hideLikeLogEvents && entry.eventType === "like") return false;
      return true;
    });
  }, [hideLikeLogEvents, hideMemberLogEvents, logs]);

  const updateRule = (id: string, patch: Partial<AutomationRule>) => {
    updateProfile((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    }));
  };

  const addRule = () => {
    updateProfile((current) => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: createId("rule"),
          name: "新规则",
          trigger: "chatKeyword",
          matchPattern: "*",
          replyTemplate: "欢迎 {user}！",
          cooldownSeconds: 10,
          minGiftDiamondCount: 0,
          enabled: false
        }
      ]
    }));
  };

  const deleteRule = (id: string) => {
    updateProfile((current) => ({ ...current, rules: current.rules.filter((rule) => rule.id !== id) }));
  };

  const updateScheduledAction = (id: string, patch: Partial<ScheduledAction>) => {
    updateProfile((current) => ({
      ...current,
      scheduledActions: current.scheduledActions.map((action) =>
        action.id === id ? ({ ...action, ...patch } as ScheduledAction) : action
      )
    }));
  };

  const updateTimedBarragePool = (
    patch: Partial<Pick<AssistantProfile["timedBarragePool"], "enabled" | "intervalSeconds" | "mode">>
  ) => {
    updateProfile((current) => ({
      ...current,
      timedBarragePool: {
        ...current.timedBarragePool,
        ...patch
      }
    }));
    if (patch.enabled === false) clearPendingTimedBarrageQueue();
  };

  const updateTimedBarrageItem = (id: string, patch: Partial<TimedBarrageItem>) => {
    updateProfile((current) => ({
      ...current,
      timedBarragePool: {
        ...current.timedBarragePool,
        items: current.timedBarragePool.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
      }
    }));
  };

  const addTimedBarrage = () => {
    updateProfile((current) => ({
      ...current,
      timedBarragePool: {
        ...current.timedBarragePool,
        items: [
          ...current.timedBarragePool.items,
          {
            id: createId("timed_barrage"),
            label: "定时弹幕",
            text: "欢迎大家关注主播～",
            enabled: true
          }
        ]
      }
    }));
  };

  const refreshAiTimedBarrage = async () => {
    if (aiTimedBarrageLoading) return;

    const currentPool = profileRef.current.timedBarragePool;
    const enabledExamples = currentPool.items.filter((item) => item.enabled && item.text.trim()).map((item) => item.text.trim());
    const allExamples = currentPool.items.map((item) => item.text.trim()).filter(Boolean);
    const examples = enabledExamples.length ? enabledExamples : allExamples;

    setAiTimedBarrageLoading(true);
    setAiTimedBarrageError(undefined);
    try {
      const response = await chromeRuntimeSendMessage<GenerateTimedBarrageResponse>({
        type: "DMW_GENERATE_TIMED_BARRAGE",
        styleId: aiTimedBarrageStyleId,
        mode: currentPool.mode,
        examples,
        maxLength: profileRef.current.maxReplyLength
      });

      if (!response) {
        setAiTimedBarrageError("AI 生成通道不可用，请重新加载扩展");
        return;
      }

      if (!response.ok) {
        setAiTimedBarrageError(response.error ?? "AI 弹幕生成失败");
        return;
      }

      const text = cleanAiTimedBarrageText(response.text, profileRef.current.maxReplyLength);
      if (!text) {
        setAiTimedBarrageError("AI 没有返回可用弹幕");
        return;
      }

      setAiTimedBarrageText(text);
      appendLog("assistant", "已刷新 AI 生成弹幕");
    } catch (error) {
      setAiTimedBarrageError(error instanceof Error ? error.message : "AI 弹幕生成异常");
    } finally {
      setAiTimedBarrageLoading(false);
    }
  };

  const addAiTimedBarrage = () => {
    const text = cleanAiTimedBarrageText(aiTimedBarrageText, profile.maxReplyLength);
    if (!text) {
      setAiTimedBarrageError("请先刷新生成一条弹幕");
      return;
    }

    const styleLabel = AI_TIMED_BARRAGE_STYLES.find((style) => style.id === aiTimedBarrageStyleId)?.label ?? "AI";
    updateProfile((current) => ({
      ...current,
      timedBarragePool: {
        ...current.timedBarragePool,
        items: [
          ...current.timedBarragePool.items,
          {
            id: createId("timed_barrage_ai"),
            label: `AI ${styleLabel}`,
            text,
            enabled: true
          }
        ]
      }
    }));
    appendLog("assistant", "已将 AI 生成弹幕加入定时弹幕池");
  };

  const deleteTimedBarrage = (id: string) => {
    updateProfile((current) => ({
      ...current,
      timedBarragePool: {
        ...current.timedBarragePool,
        items: current.timedBarragePool.items.filter((item) => item.id !== id)
      }
    }));
  };

  const moveTimedBarrage = (id: string, direction: -1 | 1) => {
    updateProfile((current) => {
      const items = [...current.timedBarragePool.items];
      const index = items.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return current;
      const [item] = items.splice(index, 1);
      items.splice(nextIndex, 0, item);
      return {
        ...current,
        timedBarragePool: {
          ...current.timedBarragePool,
          items
        }
      };
    });
  };

  const deleteScheduledAction = (id: string) => {
    updateProfile((current) => ({
      ...current,
      scheduledActions: current.scheduledActions.filter((action) => action.id !== id)
    }));
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `douyin-moderator-profile-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    appendLog("assistant", "已导出配置");
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setProfile(normalizeProfile(JSON.parse(text)));
      appendLog("assistant", "已导入配置");
    } catch {
      appendLog("error", "配置导入失败，请检查 JSON 文件");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const likeAction = profile.scheduledActions.find((action) => action.kind === "like");
  const timedBarragePool = profile.timedBarragePool;
  const timedBarrages = timedBarragePool.items;
  const likeStatusText = liveAutoLikeWaiting
    ? likeAction?.enabled
      ? `下一轮倒计时 ${formatDuration(liveAutoLikeRemainingMs)}`
      : `已临时关闭，下一轮倒计时 ${formatDuration(liveAutoLikeRemainingMs)}`
    : liveAutoLikeReadyAt
      ? likeAction?.enabled
        ? running
          ? "倒计时结束，准备执行连续点赞"
          : "倒计时结束，等待总开关运行"
        : "倒计时结束，将自动开启自动点赞"
      : likeAction?.enabled
        ? "开启后立即执行，并开始 62 分钟循环"
        : "默认关闭，开启后立即点赞并每 62 分钟循环";
  const panelStyle = useMemo<CSSProperties>(
    () => ({
      left: panelBounds.left,
      top: panelBounds.top,
      width: panelBounds.width,
      height: panelBounds.height
    }),
    [panelBounds]
  );
  const launcherStyle = useMemo(() => createLauncherStyle(panelBounds), [panelBounds]);

  if (!visible) {
    return (
      <button className="dmw-launcher" style={launcherStyle} type="button" onClick={() => setVisible(true)}>
        <Activity size={16} />
        房管助手
      </button>
    );
  }

  return (
    <aside className="dmw-panel" style={panelStyle} aria-label="抖音直播间房管助手">
      <header className="dmw-header" onPointerDown={(event) => beginPanelInteraction("move", event)}>
        <div className="dmw-title-block">
          <div className="dmw-title-line">
            <GripHorizontal className="dmw-drag-icon" size={16} aria-hidden="true" />
            <div className="dmw-title">房管助手</div>
          </div>
          <div className="dmw-subtitle">当前直播页 · 本地配置</div>
        </div>
        <div className="dmw-header-actions">
          <span className={`dmw-status ${running ? "is-running" : "is-paused"}`}>
            {running ? "运行中" : "已暂停"}
          </span>
          <button className="dmw-icon-button" type="button" title="最小化助手" onClick={() => setVisible(false)}>
            <Minus size={16} />
          </button>
        </div>
      </header>

      <section className="dmw-control-band">
        <button
          className={`dmw-run-button ${running ? "is-running" : ""}`}
          type="button"
          onClick={() => {
            setRunning((current) => !current);
            appendLog("assistant", running ? "已暂停本页自动化" : "已开始本页自动化");
          }}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
          {running ? "暂停" : "开始"}
        </button>
        <button
          className={`dmw-hosted-button ${profile.hostedModeEnabled ? "is-active" : ""}`}
          type="button"
          title={profile.hostedModeEnabled ? "托管模式已开启" : "托管关闭时，开播检测不会自动启动功能"}
          onClick={toggleHostedMode}
        >
          <Activity size={16} />
          {profile.hostedModeEnabled ? "托管中" : "托管模式"}
        </button>
        <div className="dmw-metrics" aria-label="本页状态">
          <span>{enabledRuleCount} 条启用</span>
          <span>{pendingQueueCount} 条待发</span>
          <span>{events.length} 条事件</span>
        </div>
      </section>

      <nav className="dmw-tabs" aria-label="助手功能">
        <button className={activeTab === "rules" ? "is-active" : ""} type="button" onClick={() => setActiveTab("rules")}>
          <ListChecks size={15} />
          规则
        </button>
        <button
          className={activeTab === "scheduled" ? "is-active" : ""}
          type="button"
          onClick={() => setActiveTab("scheduled")}
        >
          <Heart size={15} />
          定时
        </button>
        <button className={activeTab === "logs" ? "is-active" : ""} type="button" onClick={() => setActiveTab("logs")}>
          <MessageSquare size={15} />
          日志
        </button>
      </nav>

      <main className="dmw-content">
        {activeTab === "rules" && (
          <section className="dmw-section">
            <div className="dmw-section-heading">
              <h2>自动回复规则</h2>
              <button className="dmw-secondary-button" type="button" onClick={addRule}>
                <Plus size={15} />
                添加
              </button>
            </div>

            <div className="dmw-rule-list">
              {profile.rules.map((rule) => {
                const support = adapter.getTriggerSupport(rule.trigger);
                return (
                  <div className="dmw-rule-row" key={rule.id}>
                    <div className="dmw-row-topline">
                      <label className="dmw-switch">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(event) => updateRule(rule.id, { enabled: event.currentTarget.checked })}
                        />
                        <span />
                      </label>
                      <input
                        className="dmw-rule-name"
                        value={rule.name}
                        onChange={(event) => updateRule(rule.id, { name: event.currentTarget.value })}
                      />
                      <span className={`dmw-support is-${support}`}>{supportLabels[support]}</span>
                      <button
                        className="dmw-icon-button"
                        type="button"
                        title="删除规则"
                        onClick={() => deleteRule(rule.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="dmw-grid-two">
                      <label>
                        <span>触发</span>
                        <select
                          value={rule.trigger}
                          onChange={(event) => updateRule(rule.id, { trigger: event.currentTarget.value as TriggerType })}
                        >
                          {TRIGGER_TYPES.map((trigger) => (
                            <option key={trigger} value={trigger}>
                              {triggerLabels[trigger]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>冷却</span>
                        <input
                          type="number"
                          min={0}
                          max={3600}
                          value={rule.cooldownSeconds}
                          onChange={(event) => {
                            const cooldownSeconds = clampNumber(Number(event.currentTarget.value), 0, 3600);
                            updateRule(rule.id, { cooldownSeconds });
                          }}
                        />
                      </label>
                    </div>
                    <label className="dmw-field">
                      <span>匹配内容</span>
                      <input
                        value={rule.matchPattern}
                        onChange={(event) => updateRule(rule.id, { matchPattern: event.currentTarget.value })}
                      />
                    </label>
                    {isGiftTrigger(rule.trigger) && (
                      <>
                        <label className="dmw-field">
                          <span>感谢门槛（钻）</span>
                          <input
                            type="number"
                            min={0}
                            max={100000000}
                            value={rule.minGiftDiamondCount}
                            onChange={(event) => {
                              const minGiftDiamondCount = clampNumber(Number(event.currentTarget.value), 0, 100000000);
                              updateRule(rule.id, { minGiftDiamondCount });
                            }}
                          />
                        </label>
                        <div className="dmw-gift-tier-list">
                          <div className="dmw-gift-tier-title">分档感谢</div>
                          {GIFT_REPLY_TIER_DEFINITIONS.map((tier) => (
                            <label className="dmw-gift-tier-field" key={tier.id}>
                              <span>{tier.label}</span>
                              <textarea
                                rows={2}
                                value={giftTierTemplate(rule, tier.id)}
                                onChange={(event) =>
                                  updateRule(rule.id, {
                                    giftReplyTiers: updateGiftTierTemplate(rule, tier.id, event.currentTarget.value)
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                    <label className="dmw-field">
                      <span>回复模板</span>
                      <textarea
                        rows={2}
                        value={rule.replyTemplate}
                        onChange={(event) => updateRule(rule.id, { replyTemplate: event.currentTarget.value })}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {activeTab === "scheduled" && (
          <section className="dmw-section">
            <div className="dmw-section-heading">
              <h2>定时动作</h2>
              <button className="dmw-secondary-button" type="button" onClick={addTimedBarrage}>
                <Plus size={15} />
                弹幕
              </button>
            </div>

            <div className="dmw-settings-strip">
              <label>
                <span>全局发送间隔</span>
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={profile.globalSendIntervalSeconds}
                  onChange={(event) => {
                    const globalSendIntervalSeconds = clampNumber(Number(event.currentTarget.value), 5, 300);
                    updateProfile((current) => ({
                      ...current,
                      globalSendIntervalSeconds
                    }));
                  }}
                />
              </label>
              <label>
                <span>弹幕字数上限</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={profile.maxReplyLength}
                  onChange={(event) => {
                    const maxReplyLength = clampNumber(Number(event.currentTarget.value), 1, 200);
                    updateProfile((current) => ({
                      ...current,
                      maxReplyLength
                    }));
                  }}
                />
              </label>
              <div className="dmw-inline-setting">
                <label className="dmw-switch">
                  <input
                    type="checkbox"
                    checked={profile.verifyBarrageInputBeforeSend}
                    onChange={(event) => {
                      const verifyBarrageInputBeforeSend = event.currentTarget.checked;
                      updateProfile((current) => ({
                        ...current,
                        verifyBarrageInputBeforeSend
                      }));
                    }}
                  />
                  <span />
                </label>
                <div className="dmw-scheduled-main">
                  <strong>写入校验</strong>
                  <span>{profile.verifyBarrageInputBeforeSend ? "发送前确认输入框内容一致" : "跳过读回检查直接发送"}</span>
                </div>
              </div>
            </div>

            <div className="dmw-scheduled-row">
              <div className="dmw-scheduled-main">
                <strong>开播监控</strong>
                <span>
                  {liveMonitorLabel(liveMonitorStatus)} · 每 {Math.round(timings.liveMonitorIntervalMs / 1000)} 秒检测
                  {!profile.hostedModeEnabled ? " · 托管未开启" : ""}
                  {liveAutoTimedBarrageActive
                    ? ` · 开播窗口 ${formatDuration(liveAutoTimedBarrageRemainingMs)}`
                    : ""}
                </span>
              </div>
              <span className={`dmw-support is-${liveMonitorSupportTone}`}>
                {!profile.hostedModeEnabled ? "托管关" : liveAutoTimedBarrageActive ? "窗口中" : liveMonitorLabel(liveMonitorStatus)}
              </span>
            </div>

            <div className="dmw-scheduled-row">
              <label className="dmw-switch">
                <input
                  type="checkbox"
                  checked={timedBarragePool.enabled}
                  onChange={(event) => updateTimedBarragePool({ enabled: event.currentTarget.checked })}
                />
                <span />
              </label>
              <div className="dmw-scheduled-main">
                <strong>定时弹幕池</strong>
                <span>
                  {timedBarrages.filter((item) => item.enabled).length}/{timedBarrages.length} 条启用
                </span>
              </div>
              <label className="dmw-compact-field">
                <span>间隔</span>
                <input
                  className="dmw-small-number"
                  type="number"
                  min={30}
                  value={timedBarragePool.intervalSeconds}
                  onChange={(event) =>
                    updateTimedBarragePool({
                      intervalSeconds: clampNumber(Number(event.currentTarget.value), 30, 86400)
                    })
                  }
                />
              </label>
              <label className="dmw-compact-field">
                <span>模式</span>
                <select
                  className="dmw-small-select"
                  value={timedBarragePool.mode}
                  onChange={(event) =>
                    updateTimedBarragePool({ mode: event.currentTarget.value as TimedBarrageMode })
                  }
                >
                  <option value="random">随机</option>
                  <option value="sequential">顺序</option>
                </select>
              </label>
            </div>

            <div className="dmw-ai-barrage-box">
              <div className="dmw-ai-barrage-header">
                <div className="dmw-scheduled-main">
                  <strong>AI 生成弹幕</strong>
                  <span>DeepSeek · 按当前本地定时弹幕池生成</span>
                </div>
                <label className="dmw-compact-field">
                  <span>风格</span>
                  <select
                    className="dmw-ai-style-select"
                    value={aiTimedBarrageStyleId}
                    onChange={(event) => setAiTimedBarrageStyleId(event.currentTarget.value as AiTimedBarrageStyleId)}
                  >
                    {AI_TIMED_BARRAGE_STYLES.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                className="dmw-ai-barrage-text"
                rows={2}
                value={aiTimedBarrageText}
                placeholder="点击刷新生成一条和当前弹幕池风格一致的弹幕"
                onChange={(event) => {
                  setAiTimedBarrageText(cleanAiTimedBarrageText(event.currentTarget.value, profile.maxReplyLength));
                  setAiTimedBarrageError(undefined);
                }}
              />
              <div className="dmw-ai-barrage-actions">
                <button
                  className="dmw-secondary-button"
                  type="button"
                  disabled={aiTimedBarrageLoading}
                  onClick={() => void refreshAiTimedBarrage()}
                >
                  {aiTimedBarrageLoading ? <RefreshCcw className="dmw-spin-icon" size={15} /> : <Sparkles size={15} />}
                  {aiTimedBarrageLoading ? "生成中" : "刷新生成"}
                </button>
                <button
                  className="dmw-secondary-button"
                  type="button"
                  disabled={!aiTimedBarrageText.trim()}
                  onClick={addAiTimedBarrage}
                >
                  <Plus size={15} />
                  加入弹幕池
                </button>
                {aiTimedBarrageError && <span className="dmw-ai-barrage-error">{aiTimedBarrageError}</span>}
              </div>
            </div>

            {likeAction && (
              <div className="dmw-scheduled-row">
                <label className="dmw-switch">
                  <input
                    type="checkbox"
                    checked={likeAction.enabled}
                    onChange={() => toggleLiveAutoLike("手动开关")}
                  />
                  <span />
                </label>
                <div className="dmw-scheduled-main">
                  <strong>自动点赞</strong>
                  <span>{likeStatusText} · 快捷键 Alt+Shift+L · 关闭不重置倒计时 · 时长 1-400 秒</span>
                </div>
                <input
                  className="dmw-small-number"
                  type="number"
                  min={1}
                  max={400}
                  value={likeAction.intervalSeconds}
                  onChange={(event) =>
                    updateScheduledAction(likeAction.id, {
                      intervalSeconds: clampNumber(Number(event.currentTarget.value), 1, 400)
                    })
                  }
                />
              </div>
            )}

            <div className="dmw-rule-list">
              {timedBarrages.length === 0 && <div className="dmw-empty">暂无定时弹幕</div>}
              {timedBarrages.map((item, index) => (
                <div className="dmw-rule-row" key={item.id}>
                  <div className="dmw-row-topline">
                    <label className="dmw-switch">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(event) => updateTimedBarrageItem(item.id, { enabled: event.currentTarget.checked })}
                      />
                      <span />
                    </label>
                    <input
                      className="dmw-rule-name"
                      value={item.label}
                      onChange={(event) => updateTimedBarrageItem(item.id, { label: event.currentTarget.value })}
                    />
                    <button
                      className="dmw-icon-button"
                      type="button"
                      title="上移"
                      disabled={index === 0}
                      onClick={() => moveTimedBarrage(item.id, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="dmw-icon-button"
                      type="button"
                      title="下移"
                      disabled={index === timedBarrages.length - 1}
                      onClick={() => moveTimedBarrage(item.id, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="dmw-icon-button"
                      type="button"
                      title="删除定时弹幕"
                      onClick={() => deleteTimedBarrage(item.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <label className="dmw-field">
                    <span>弹幕内容</span>
                    <textarea
                      rows={2}
                      value={item.text}
                      onChange={(event) => updateTimedBarrageItem(item.id, { text: event.currentTarget.value })}
                    />
                  </label>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "logs" && (
          <section className="dmw-section">
            <div className="dmw-section-heading">
              <h2>发送队列</h2>
              <button className="dmw-secondary-button" type="button" onClick={() => setQueue([])}>
                清空
              </button>
            </div>
            <div className="dmw-queue-list">
              {queue.length === 0 && <div className="dmw-empty">暂无待发送弹幕</div>}
              {[...queue].reverse().map((item) => (
                <div className="dmw-queue-row" key={item.id}>
                  <span className={`dmw-queue-status is-${item.status}`}>{queueStatusLabels[item.status]}</span>
                  <div>
                    <strong>{item.text}</strong>
                    <span>{item.error || item.source}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="dmw-section-heading is-compact">
              <h2>Session Log</h2>
              <div className="dmw-heading-actions">
                <button
                  className={`dmw-secondary-button ${hideMemberLogEvents ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={hideMemberLogEvents}
                  title={hideMemberLogEvents ? "显示进入直播间事件" : "隐藏进入直播间事件"}
                  onClick={() => setHideMemberLogEvents((current) => !current)}
                >
                  {hideMemberLogEvents ? "显示进房" : "隐藏进房"}
                </button>
                <button
                  className={`dmw-secondary-button ${hideLikeLogEvents ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={hideLikeLogEvents}
                  title={hideLikeLogEvents ? "显示点赞事件" : "隐藏点赞事件"}
                  onClick={() => setHideLikeLogEvents((current) => !current)}
                >
                  {hideLikeLogEvents ? "显示点赞" : "隐藏点赞"}
                </button>
              </div>
            </div>
            <div className="dmw-log-list">
              {visibleLogs.length === 0 && <div className="dmw-empty">暂无可显示日志</div>}
              {visibleLogs.map((entry) => (
                <div className="dmw-log-row" key={entry.id}>
                  <span>{formatTime(entry.timestamp)}</span>
                  <span className={`dmw-log-kind is-${entry.kind}`}>
                    {entry.eventType ? liveEventLabels[entry.eventType] : logKindLabels[entry.kind]}
                  </span>
                  <span className="dmw-log-user" title={entry.userName}>
                    {entry.userName}
                  </span>
                  <p>{entry.message}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="dmw-footer">
        <input
          ref={fileInputRef}
          className="dmw-file-input"
          type="file"
          accept="application/json"
          onChange={(event) => void handleImport(event.currentTarget.files?.[0])}
        />
        <button className="dmw-quiet-button" type="button" onClick={() => fileInputRef.current?.click()}>
          <Upload size={14} />
          导入
        </button>
        <button className="dmw-quiet-button" type="button" onClick={handleExport}>
          <Download size={14} />
          导出
        </button>
      </footer>
      <button
        className="dmw-resize-handle"
        type="button"
        aria-label="调整助手大小"
        title="调整大小"
        onPointerDown={(event) => beginPanelInteraction("resize", event)}
      />
    </aside>
  );
}
