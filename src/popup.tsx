import { ExternalLink } from "lucide-react";
import { createRoot } from "react-dom/client";
import { PRIMARY_LIVE_ROOM_ID } from "./storage/runtimeSettings";
import "./styles/popup.css";

function Popup() {
  return (
    <main className="popup">
      <header>
        <div>
          <h1>小光Ray房管助手</h1>
          <p>在网页端抖音直播页内运行</p>
        </div>
      </header>

      <section className="popup-status">
        <strong>使用方式</strong>
        <p>默认只在直播间 {PRIMARY_LIVE_ROOM_ID} 运行。插件使用当前浏览器登录态，不保存账号 Cookie。</p>
      </section>

      <a className="popup-link" href="https://live.douyin.com/" target="_blank" rel="noreferrer">
        <ExternalLink size={15} />
        打开抖音直播
      </a>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
