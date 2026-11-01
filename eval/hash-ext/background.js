// Opens the check as soon as the extension is loaded, so there's nothing to click.
/* global browser, chrome */
const api = globalThis.browser ?? chrome;
api.runtime.onInstalled.addListener(() => {
  api.tabs.create({ url: api.runtime.getURL('check.html') });
});
