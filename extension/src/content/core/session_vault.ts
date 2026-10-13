import { STORAGE_KEYS } from "../../lib/constants";

/**
 * The extension's own copy of armed sessions, in chrome.storage.local (pages cannot read or write
 * it). sessionStorage only carries the session's random token across a reload; the session that is
 * resumed is the one stored here under that token.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Vault<T> = Record<string, { session: T; savedAt: number }>;

async function read<T>(): Promise<Vault<T>> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.ARMED_SESSIONS);
  const vault = data[STORAGE_KEYS.ARMED_SESSIONS];
  return vault && typeof vault === "object" ? (vault as Vault<T>) : {};
}

// Writes of this content script are queued so they never overwrite each other.
let writes: Promise<unknown> = Promise.resolve();
function update<T>(change: (vault: Vault<T>) => void): Promise<void> {
  const next = writes.then(async () => {
    const vault = await read<T>();
    const now = Date.now();
    for (const k of Object.keys(vault)) if (now - (vault[k]?.savedAt ?? 0) > MAX_AGE_MS) delete vault[k];
    change(vault);
    await chrome.storage.local.set({ [STORAGE_KEYS.ARMED_SESSIONS]: vault });
  });
  writes = next.catch(() => {});
  return next;
}

export function newSessionToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export const sessionVault = {
  save<T>(token: string, session: T): Promise<void> {
    return update<T>((vault) => {
      vault[token] = { session, savedAt: Date.now() };
    });
  },
  async load<T>(token: string): Promise<T | null> {
    if (!token) return null;
    try {
      await writes;
      return (await read<T>())[token]?.session ?? null;
    } catch {
      return null;
    }
  },
  remove(token: string | undefined): Promise<void> {
    if (!token) return Promise.resolve();
    return update((vault) => {
      delete vault[token];
    });
  },
};
