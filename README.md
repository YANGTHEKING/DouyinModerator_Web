# DouyinModerator Web

Chrome MV3 extension for a Douyin live room moderator assistant. It works on the current `https://live.douyin.com/*` page, uses the browser's existing Douyin login state, and avoids high-sensitivity permissions such as cookies, webRequest, and debugger.

## MVP Scope

- Injects a right-side assistant panel on Douyin live pages.
- Saves one browser-local Assistant Profile with automation rules and scheduled actions.
- Ships disabled default rules for welcome, follow, gift, and fansclub events.
- Observes visible Interaction Feed DOM changes and converts recognized items into Live Events.
- Supports Run Session / Paused Session behavior.
- Sends Barrage Replies through the page input box and send button.
- Supports a global Send Queue, basic Send Guard, rule cooldowns, timed barrages, and auto likes.
- Supports Assistant Profile import/export as JSON.

## Commands

```bash
npm install
npm run build
npm run dev
```

## Local Preview

Run `npm run dev` and open the Vite URL. The preview page renders the same sidebar component with a mock page adapter that emits sample live events.

## Reply Templates

Rule replies can use `{user}`, `{gift}`, `{count}`, `{content}`, `{diamonds}`, and `{totalDiamonds}`. Gift diamond values are filled only when the local catalog or the visible page can resolve the gift without ambiguity.

## Install In Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load the generated `dist/` directory as an unpacked extension.
5. Open a `https://live.douyin.com/*` page. The assistant panel appears on the right.

For the packaged release and a picture-based end-user walkthrough, see [docs/使用说明.md](docs/使用说明.md).

## Notes

The first page adapter intentionally reads visible page activity instead of decoding Douyin WebSocket protobuf messages. Some trigger types are marked as partially supported because Douyin page markup can vary and hidden or folded events may not be visible in the DOM.
