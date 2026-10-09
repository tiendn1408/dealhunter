import { DEALHUNTER_WEB_ORIGINS, STORAGE_KEYS, WEB_SESSION_MESSAGE } from "../lib/constants";
import { WebSession } from "../lib/types";
import { storage } from "../lib/storage";
import { validateApiUrl, validateWebUrl } from "../lib/endpoints";

/**
 * Sign-in session handed over by the DealHunter web app.
 *
 * The extension never refreshes it: refresh tokens rotate strictly and a refresh racing the web app's
 * would revoke every session. The web app pushes a fresh access token on sign-in and on each refresh,
 * and clears it on sign-out. Without a valid token the extension only offers its deal-hunting tools.
 * The same message carries the web app's API and web URLs. They are stored WITH the token, as one record
 * written in a single chrome.storage.session set: two DealHunter pages (e.g. dev and production) pushing
 * at once can only replace each other's whole record, so a token is never paired with another page's API
 * URL. The web URL is also remembered on its own (chrome.storage.local) so links keep working after sign-out.
 */
export const webSession = {
  async get(): Promise<WebSession | null> {
    const data = await chrome.storage.session.get(STORAGE_KEYS.WEB_SESSION);
    const session = data[STORAGE_KEYS.WEB_SESSION] as WebSession | undefined;
    if (!session || session.expiresAt <= Date.now()) return null;
    // A record without a valid API URL of its own (e.g. stored by an older version) is not usable
    const apiUrl = validateApiUrl(session.apiUrl);
    if (!apiUrl) return null;
    return { ...session, apiUrl, webUrl: validateWebUrl(session.webUrl) ?? undefined };
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

    // The web app's own API and web URLs. Kept only when valid: the API must be a DealHunter host and
    // the web URL must be the sending page's origin.
    const apiUrl = validateApiUrl(msg.apiUrl);
    const webUrl = validateWebUrl(msg.webUrl, origin);

    const token = msg.accessToken;
    const expiresAt = msg.expiresAt;
    const tokenValid = typeof token === "string" && !!token && typeof expiresAt === "number" && expiresAt > Date.now();
    // A token whose API is unknown (no valid apiUrl sent with it) has nowhere it may be sent: not stored
    if (!tokenValid || !apiUrl) {
      await this.clear();
    } else {
      await this.set({
        accessToken: token as string,
        expiresAt: expiresAt as number,
        email: typeof msg.email === "string" ? msg.email : undefined,
        name: typeof msg.name === "string" ? msg.name : undefined,
        apiUrl,
        webUrl: webUrl ?? undefined,
      });
    }
    if (webUrl) await storage.saveLastWebUrl(webUrl);
    return true;
  },
};
