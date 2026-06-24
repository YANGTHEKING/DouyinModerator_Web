import {
  Activity,
  Download,
  GripHorizontal,
  Heart,
  ListChecks,
  MessageSquare,
  Minus,
  Pause,
  Play,
  Plus,
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
import { createId } from "../domain/ids";
import {
  liveEventLabels,
  logKindLabels,
  queueStatusLabels,
  supportLabels,
  triggerLabels
} from "../domain/labels";
import { canFireRule, ruleMatchesEvent } from "../domain/rules";
import { checkSendGuard } from "../domain/sendGuard";
import { resolveReplyTemplate } from "../domain/templates";
import {
  AssistantProfile,
  AutomationRule,
  LiveEvent,
  PageAdapter,
  ScheduledAction,
  SendQueueItem,
  SessionLogEntry,
  LiveEventType,
  TriggerType,
  TRIGGER_TYPES
} from "../domain/types";
import { loadProfile, normalizeProfile, saveProfile } from "../storage/profileStorage";

type TabKey = "rules" | "scheduled" | "logs";

interface SidebarAppProps {
  adapter: PageAdapter;
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

export function SidebarApp({ adapter }: SidebarAppProps) {
  const [visible, setVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("rules");
  const [panelBounds, setPanelBounds] = useState<PanelBounds>(() => createInitialPanelBounds());
  const [profile, setProfile] = useState<AssistantProfile>(() => createDefaultProfile());
  const [profileReady, setProfileReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const [queue, setQueue] = useState<SendQueueItem[]>([]);
  const [hideMemberLogEvents, setHideMemberLogEvents] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef(profile);
  const runningRef = useRef(running);
  const queueRef = useRef(queue);
  const lastRuleFiredRef = useRef(new Map<string, number>());
  const lastBarrageAtRef = useRef(0);
  const lastSentTextRef = useRef<string | undefined>(undefined);
  const processingRef = useRef(false);
  const panelBoundsRef = useRef(panelBounds);
  const panelInteractionRef = useRef<PanelInteraction | null>(null);
  const bodyCursorRef = useRef("");
  const bodyUserSelectRef = useRef("");

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

      if (!runningRef.current) return;

      const now = Date.now();
      const currentProfile = profileRef.current;
      for (const rule of currentProfile.rules) {
        if (!ruleMatchesEvent(rule, event)) continue;
        const support = adapter.getTriggerSupport(rule.trigger);
        if (support === "pending") {
          appendLog("warning", `规则「${rule.name}」的触发条件暂未适配当前页面`);
          continue;
        }
        if (!canFireRule(rule, lastRuleFiredRef.current.get(rule.id), now)) continue;
        lastRuleFiredRef.current.set(rule.id, now);
        enqueueBarrage(resolveReplyTemplate(rule.replyTemplate, event), `规则：${rule.name}`, event.id);
      }
    });

    return stop;
  }, [adapter, appendLog, enqueueBarrage]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (!runningRef.current || processingRef.current) return;
      const currentProfile = profileRef.current;
      if (Date.now() - lastBarrageAtRef.current < currentProfile.globalSendIntervalSeconds * 1000) return;

      const next = queueRef.current.find((item) => item.status === "pending");
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

      const result = await adapter.sendBarrage(guard.text);
      if (result.ok) {
        lastBarrageAtRef.current = Date.now();
        lastSentTextRef.current = guard.text;
        setQueue((current) =>
          current.map((item) =>
            item.id === next.id ? { ...item, status: "sent", sentAt: Date.now() } : item
          )
        );
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
    if (!running) return;

    const timers = profile.scheduledActions
      .filter((action) => action.enabled)
      .map((action) => {
        const intervalSeconds = Math.max(30, action.intervalSeconds);
        return window.setInterval(() => {
          if (!runningRef.current) return;
          if (action.kind === "barrage") {
            enqueueBarrage(action.text, `定时弹幕：${action.label}`, undefined, { allowRepeat: true });
            return;
          }

          adapter.sendLike().then((result) => {
            if (result.ok) appendLog("send", "已执行自动点赞");
            else appendLog("error", `自动点赞失败：${result.error ?? "未知错误"}`);
          });
        }, intervalSeconds * 1000);
      });

    return () => timers.forEach((timer) => window.clearInterval(timer));
  }, [adapter, appendLog, enqueueBarrage, profile.scheduledActions, running]);

  const enabledRuleCount = useMemo(() => profile.rules.filter((rule) => rule.enabled).length, [profile.rules]);
  const pendingQueueCount = useMemo(() => queue.filter((item) => item.status === "pending").length, [queue]);
  const visibleLogs = useMemo(() => {
    if (!hideMemberLogEvents) return logs;
    return logs.filter((entry) => entry.eventType !== "member");
  }, [hideMemberLogEvents, logs]);

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

  const addTimedBarrage = () => {
    updateProfile((current) => ({
      ...current,
      scheduledActions: [
        ...current.scheduledActions,
        {
          id: createId("scheduled"),
          kind: "barrage",
          label: "定时弹幕",
          text: "欢迎大家关注主播～",
          intervalSeconds: 120,
          enabled: false
        }
      ]
    }));
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
  const timedBarrages = profile.scheduledActions.filter((action) => action.kind === "barrage");
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
                          onChange={(event) =>
                            updateRule(rule.id, {
                              cooldownSeconds: clampNumber(Number(event.currentTarget.value), 0, 3600)
                            })
                          }
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
                  onChange={(event) =>
                    updateProfile((current) => ({
                      ...current,
                      globalSendIntervalSeconds: clampNumber(Number(event.currentTarget.value), 5, 300)
                    }))
                  }
                />
              </label>
              <label>
                <span>弹幕字数上限</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={profile.maxReplyLength}
                  onChange={(event) =>
                    updateProfile((current) => ({
                      ...current,
                      maxReplyLength: clampNumber(Number(event.currentTarget.value), 1, 200)
                    }))
                  }
                />
              </label>
            </div>

            {likeAction && (
              <div className="dmw-scheduled-row">
                <label className="dmw-switch">
                  <input
                    type="checkbox"
                    checked={likeAction.enabled}
                    onChange={(event) => updateScheduledAction(likeAction.id, { enabled: event.currentTarget.checked })}
                  />
                  <span />
                </label>
                <div className="dmw-scheduled-main">
                  <strong>自动点赞</strong>
                  <span>最小间隔 30 秒</span>
                </div>
                <input
                  className="dmw-small-number"
                  type="number"
                  min={30}
                  value={likeAction.intervalSeconds}
                  onChange={(event) =>
                    updateScheduledAction(likeAction.id, {
                      intervalSeconds: clampNumber(Number(event.currentTarget.value), 30, 86400)
                    })
                  }
                />
              </div>
            )}

            <div className="dmw-rule-list">
              {timedBarrages.map((action) => (
                <div className="dmw-rule-row" key={action.id}>
                  <div className="dmw-row-topline">
                    <label className="dmw-switch">
                      <input
                        type="checkbox"
                        checked={action.enabled}
                        onChange={(event) => updateScheduledAction(action.id, { enabled: event.currentTarget.checked })}
                      />
                      <span />
                    </label>
                    <input
                      className="dmw-rule-name"
                      value={action.label}
                      onChange={(event) => updateScheduledAction(action.id, { label: event.currentTarget.value })}
                    />
                    <button
                      className="dmw-icon-button"
                      type="button"
                      title="删除定时弹幕"
                      onClick={() => deleteScheduledAction(action.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="dmw-grid-two">
                    <label>
                      <span>间隔</span>
                      <input
                        type="number"
                        min={30}
                        value={action.intervalSeconds}
                        onChange={(event) =>
                          updateScheduledAction(action.id, {
                            intervalSeconds: clampNumber(Number(event.currentTarget.value), 30, 86400)
                          })
                        }
                      />
                    </label>
                    <span className="dmw-muted">默认建议 120 秒</span>
                  </div>
                  <label className="dmw-field">
                    <span>弹幕内容</span>
                    <textarea
                      rows={2}
                      value={action.text}
                      onChange={(event) => updateScheduledAction(action.id, { text: event.currentTarget.value })}
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
              <button
                className={`dmw-secondary-button ${hideMemberLogEvents ? "is-active" : ""}`}
                type="button"
                aria-pressed={hideMemberLogEvents}
                title={hideMemberLogEvents ? "显示进入直播间事件" : "隐藏进入直播间事件"}
                onClick={() => setHideMemberLogEvents((current) => !current)}
              >
                {hideMemberLogEvents ? "显示进房" : "隐藏进房"}
              </button>
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
