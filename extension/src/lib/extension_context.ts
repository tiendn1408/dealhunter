/**
 * After the extension is reloaded or updated, Chrome leaves the old content script running in the
 * tabs that were already open, but cut off from the extension: every chrome.* call then throws
 * "Extension context invalidated" synchronously (a `.catch()` on the promise does not see it).
 */

/** True while this script can still talk to the extension. */
export function isExtensionAlive(): boolean {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/** Fire-and-forget message to the background that never throws, even from an orphaned script. */
export function notifyBackground(message: Record<string, unknown>): void {
  if (!isExtensionAlive()) return;
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // context invalidated between the check and the call
  }
}
