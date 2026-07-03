import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { createDouyinPageAdapter } from "./adapters/douyinPageAdapter";
import cssText from "./styles/sidebar.css?inline";
import { loadLearnedGiftCatalog } from "./storage/learnedGiftCatalogStorage";
import {
  isAssistantAllowedOnUrl,
  isRuntimeSettingsStorageKey,
  loadRuntimeSettings
} from "./storage/runtimeSettings";
import { SidebarApp } from "./ui/SidebarApp";

const HOST_ID = "douyin-moderator-web-root";
let root: Root | undefined;
let host: HTMLElement | undefined;
let syncSerial = 0;
let lastHref = window.location.href;

function mount(): void {
  if (document.getElementById(HOST_ID)) return;

  host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = cssText;

  const rootElement = document.createElement("div");
  rootElement.className = "dmw-shadow-root";

  shadow.append(style, rootElement);
  const currentHost = host;
  void loadLearnedGiftCatalog().finally(() => {
    if (host !== currentHost || !document.documentElement.contains(currentHost)) return;
    root = createRoot(rootElement);
    root.render(<SidebarApp adapter={createDouyinPageAdapter()} />);
  });
}

function unmount(): void {
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
}

async function syncMount(): Promise<void> {
  const serial = ++syncSerial;
  const settings = await loadRuntimeSettings();
  if (serial !== syncSerial) return;

  if (isAssistantAllowedOnUrl(window.location, settings)) mount();
  else unmount();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void syncMount(), { once: true });
} else {
  void syncMount();
}

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!Object.keys(changes).some(isRuntimeSettingsStorageKey)) return;
    void syncMount();
  });
}

window.setInterval(() => {
  if (window.location.href === lastHref) return;
  lastHref = window.location.href;
  void syncMount();
}, 1000);
