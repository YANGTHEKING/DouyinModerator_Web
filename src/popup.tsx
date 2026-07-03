import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  loadRuntimeSettings,
  PRIMARY_LIVE_ROOM_ID,
  saveRuntimeSettings
} from "./storage/runtimeSettings";
import "./styles/popup.css";

function Popup() {
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeSettings().then((settings) => {
      if (cancelled) return;
      setDeveloperModeEnabled(settings.developerModeEnabled);
      setSettingsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateDeveloperMode = (enabled: boolean) => {
    setDeveloperModeEnabled(enabled);
    void saveRuntimeSettings({ developerModeEnabled: enabled });
  };

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
        <p>默认只在直播间 {PRIMARY_LIVE_ROOM_ID} 运行。插件使用当前浏览器登录态，不保存账号 Cookie。</p>
      </section>

      <label className="popup-toggle">
        <span>
          <strong>开发者模式</strong>
          <p>开启后，助手可在其他 live.douyin.com 直播间运行。</p>
        </span>
        <input
          type="checkbox"
          checked={developerModeEnabled}
          disabled={!settingsReady}
          onChange={(event) => updateDeveloperMode(event.currentTarget.checked)}
        />
      </label>

      <a className="popup-link" href="https://live.douyin.com/" target="_blank" rel="noreferrer">
        <ExternalLink size={15} />
        打开抖音直播
      </a>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
