import { MESSAGE_ACTIONS } from "../lib/constants";

/**
 * Opens the hunt panel on a tab, optionally straight into "pick a button" mode. A tab opened before
 * the extension was installed / updated has no content script yet: it is injected first.
 * Returns false when the page does not allow extensions (browser pages, Web Store...).
 */
export async function openHuntPanel(tabId: number, pickTarget: boolean): Promise<boolean> {
  const message = { action: MESSAGE_ACTIONS.ACTIVATE_HUD, pickTarget };
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    // no content script on this tab yet
  }
  try {
    try {
      // M11: the stylesheet first, so the panel is styled when it appears
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    } catch {
      // ignore
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

/** Pages an extension can work on. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/^https:\/\/chromewebstore\.google\.com|^https:\/\/chrome\.google\.com\/webstore/i.test(url);
}
