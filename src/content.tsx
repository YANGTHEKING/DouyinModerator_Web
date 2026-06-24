import { createRoot } from "react-dom/client";
import { createDouyinPageAdapter } from "./adapters/douyinPageAdapter";
import cssText from "./styles/sidebar.css?inline";
import { SidebarApp } from "./ui/SidebarApp";

const HOST_ID = "douyin-moderator-web-root";

function mount(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = cssText;

  const rootElement = document.createElement("div");
  rootElement.className = "dmw-shadow-root";

  shadow.append(style, rootElement);
  createRoot(rootElement).render(<SidebarApp adapter={createDouyinPageAdapter()} />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
