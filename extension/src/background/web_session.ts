import { DEALHUNTER_WEB_ORIGINS, STORAGE_KEYS, WEB_SESSION_MESSAGE } from "../lib/constants";
import { WebSession } from "../lib/types";

/**
 * Sign-in session handed over by the DealHunter web app.
 *
 * The extension never refreshes it: refresh tokens rotate strictly and a refresh racing the web app's
 * would revoke every session. The web app pushes a fresh access token on sign-in and on each refresh,
 * and clears it on sign-out. Without a valid token the extension only offers its deal-hunting tools.
 */
export const webSession = {
  async get(): Promise<WebSession | null> {
    const data = await chrome.storage.session.get(STORAGE_KEYS.WEB_SESSION);
    const session = data[STORAGE_KEYS.WEB_SESSION] as WebSession | undefined;
    if (!session || session.expiresAt <= Date.now()) return null;
    return session;
  },

  async set(session: WebSession): Promise<void> {
    await chrome.storage.session.set({ [STORAGE_KEYS.WEB_SESSION]: session });
  },

  async clear(): Promise<void> {
    await chrome.storage.session.remove(STORAGE_KEYS.WEB_SESSION);
  },

  /**
   * Handles a message from a web page (chrome.runtime.onMessageExternal). Only DealHunter web origins
   * are accepted; a guest session or a sign-out clears the stored session.
   */
  async handleExternalMessage(message: unknown, origin: string | undefined): Promise<boolean> {
    if (!origin || !DEALHUNTER_WEB_ORIGINS.includes(origin)) return false;
    const msg = message as Record<string, unknown> | null;
    if (!msg || msg.type !== WEB_SESSION_MESSAGE) return false;

    const token = msg.accessToken;
    const expiresAt = msg.expiresAt;
    if (typeof token !== "string" || !token || typeof expiresAt !== "number" || expiresAt <= Date.now()) {
      await this.clear();
      return true;
    }
    await this.set({
      accessToken: token,
      expiresAt,
      email: typeof msg.email === "string" ? msg.email : undefined,
      name: typeof msg.name === "string" ? msg.name : undefined,
    });
    return true;
  },
};
