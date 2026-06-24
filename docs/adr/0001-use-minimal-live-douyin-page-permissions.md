# Use Minimal Live Douyin Page Permissions

The Chrome extension will use Manifest V3 with permissions scoped to the Douyin live web page, storing the **Assistant Profile** with extension storage and running the assistant through content scripts on `https://live.douyin.com/*`. We will not request high-sensitivity permissions such as cookies, webRequest, or debugger for the first version because the product relies on the current page and the browser's existing Douyin login state rather than owning account or network-level access.
