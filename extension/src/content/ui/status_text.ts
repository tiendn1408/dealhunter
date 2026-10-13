import { Language, getTranslation } from "../../lib/i18n";

type Catalog = ReturnType<typeof getTranslation>;

/**
 * The engine and the coordinator report progress in English (they are UI-agnostic); this turns each
 * known status into the user's language. Unknown text is shown as is.
 */
export function translateEngineStatus(text: string, t: Catalog, _lang: Language): string {
  const count = (s: string) => parseInt(s.replace(/[^0-9]/g, ""), 10) || 0;

  if (text === "Disarmed") return t.disarmedStatus;
  if (text.startsWith("Armed · ")) return t.statusArmed(text.slice("Armed · ".length));
  if (text.startsWith("Target active · ")) return t.statusTargetActive(t.clicksLabel(count(text)));
  if (text === "Waiting for target button...") return t.statusWaitingButton;
  if (text.startsWith("Waiting for the drop: ")) return t.statusWaitingDrop(text.slice("Waiting for the drop: ".length));
  if (text.includes("Cloudflare") || text.includes("Verify you are human")) return t.turnstileChallengePrompt;
  if (text.startsWith("Burst complete")) return t.statusBurstComplete(t.clicksLabel(count(text)));
  if (text.startsWith("Pre-drop reload")) return t.statusPreDropReload;
  if (text.startsWith("Purposeful reload")) {
    const m = text.match(/\((\d+)\/(\d+)\)/);
    return t.statusRetryReload(m ? Number(m[1]) : 1, m ? Number(m[2]) : 3);
  }
  return text;
}

/** Sign-in / verification page of a marketplace, as a message in the user's language. */
export function platformBlockMessage(
  block: { site: string; kind: "verify" | "signin" },
  t: Catalog
): string {
  return block.kind === "verify" ? t.platformVerifyRequired(block.site) : t.platformSignInRequired(block.site);
}
