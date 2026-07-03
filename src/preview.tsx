import { createRoot } from "react-dom/client";
import { createEventFingerprint } from "./domain/fingerprint";
import { createId } from "./domain/ids";
import type { LiveEvent, PageAdapter, TriggerSupport, TriggerType } from "./domain/types";
import "./styles/sidebar.css";
import "./styles/preview.css";
import { SidebarApp } from "./ui/SidebarApp";

const support: Record<TriggerType, TriggerSupport> = {
  member: "partial",
  follow: "partial",
  gift: "partial",
  specificGift: "partial",
  fansclub: "partial",
  like: "partial",
  monthlyMember: "partial",
  annualMember: "partial",
  starGuardian: "partial",
  chatKeyword: "supported"
};

function makePreviewEvent(partial: Omit<LiveEvent, "id" | "fingerprint" | "timestamp">): LiveEvent {
  const timestamp = Date.now();
  const event = { ...partial, timestamp };
  return {
    ...event,
    id: createId("preview_event"),
    fingerprint: createEventFingerprint(event)
  };
}

function createPreviewAdapter(): PageAdapter {
  const samples: Array<Omit<LiveEvent, "id" | "fingerprint" | "timestamp">> = [
    {
      type: "member",
      userName: "小林",
      content: "进入直播间",
      rawText: "小林 进入直播间"
    },
    {
      type: "chat",
      userName: "吃饱就睡🌠",
      fanClubName: "孤独星",
      content: "@awen🌠 实则爽吃郁郁不起来",
      rawText: "孤独星 吃饱就睡🌠：@awen🌠 实则爽吃郁郁不起来 @awen🌠 @awen🌠"
    },
    {
      type: "gift",
      userName: "风起",
      content: "送出 小心心 x3",
      giftName: "小心心",
      count: 3,
      giftDiamondCount: 1,
      giftTotalDiamondCount: 3,
      giftValueSource: "catalog-name",
      rawText: "风起 送出 小心心 x3"
    },
    {
      type: "follow",
      userName: "晚舟",
      content: "关注主播",
      rawText: "晚舟 关注了主播"
    },
    {
      type: "starGuardian",
      userName: "星河",
      content: "开通星守护",
      rawText: "恭喜星河 开通了星守护"
    },
    {
      type: "system",
      userName: "系统",
      content: "用户 送出 Q",
      rawText: "用户 送出 Q"
    }
  ];

  return {
    observeInteractionFeed(onEvent) {
      let index = 0;
      const timer = window.setInterval(() => {
        onEvent(makePreviewEvent(samples[index % samples.length]));
        index += 1;
      }, 4500);
      return () => window.clearInterval(timer);
    },
    async sendBarrage(text) {
      console.info("[preview] send barrage", text);
      return { ok: true };
    },
    async sendLike() {
      console.info("[preview] send like");
      return { ok: true };
    },
    getTriggerSupport(trigger) {
      return support[trigger];
    }
  };
}

function PreviewPage() {
  return (
    <div className="preview-page">
      <main className="preview-live">
        <div className="preview-player">
          <span>本地预览直播画面</span>
        </div>
        <section className="preview-feed">
          <h1>抖音直播页模拟区</h1>
          <p>右侧面板使用同一个 React 组件。预览适配器会定时产生模拟互动事件，便于检查规则、队列和日志。</p>
        </section>
      </main>
      <SidebarApp adapter={createPreviewAdapter()} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<PreviewPage />);
