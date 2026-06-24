import { ExternalLink } from "lucide-react";
import { createRoot } from "react-dom/client";
import "./styles/popup.css";

function Popup() {
  return (
    <main className="popup">
      <header>
        <div>
          <h1>抖音房管助手</h1>
          <p>在网页端抖音直播页内运行</p>
        </div>
      </header>

      <section className="popup-status">
        <strong>使用方式</strong>
        <p>打开 live.douyin.com 的直播间页面，右侧会出现助手面板。插件使用当前浏览器登录态，不保存账号 Cookie。</p>
      </section>

      <a className="popup-link" href="https://live.douyin.com/" target="_blank" rel="noreferrer">
        <ExternalLink size={15} />
        打开抖音直播
      </a>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
