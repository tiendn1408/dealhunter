import { startHunt, HuntOutcome, HUNT_DEFAULTS } from "./hunt_engine";
import { elementResolver, UniversalTargetDescriptor } from "./element_resolver";
import { timeSyncClient } from "./time_sync_client";
import { targetDiagnostics } from "./target_diagnostics";
import { ClickProfileMode } from "./human_biometrics";
import { storage } from "../../lib/storage";
import { MESSAGE_ACTIONS, PRECISE_CALIBRATION_LEAD_MS } from "../../lib/constants";
import { ScheduledTask, TaskStatus, TargetDiagnosticsSummary } from "../../lib/types";
import { nextExactDropAt } from "../../lib/drop_time";
import { isSamePageUrl } from "../../lib/url";
import { reloadTiming } from "../../lib/reload_timing";
import { notifyBackground } from "../../lib/extension_context";
import { newSessionToken, sessionVault } from "./session_vault";
import { getAdapterForUrl } from "../adapters";

export const ARMED_SESSION_KEY = "dh_armed_session";

export interface ArmedSession {
  targetTimestamp: number;
  taskId?: string;
  label?: string;
  targetSlot?: string;
  customTime?: string;
  descriptor?: UniversalTargetDescriptor;
  keyword?: string;
  clickProfileMode?: ClickProfileMode;
  dualDefenseReload?: boolean;
  reloadSwitch?: boolean;
  preReloadLeadMs?: number;
  diagnostics?: TargetDiagnosticsSummary;
  url: string;
  armedAt: number;
  /** Random id: sessionStorage carries only this across a reload; the session is in the vault. */
  token: string;
}

export type CoordinatorTone = "idle" | "armed" | "firing" | "success" | "warning" | "error";

export interface CoordinatorState {
  isArmed: boolean;
  targetTimestamp: number | null;
  targetSummary: string | null;
  statusText: string;
  tone: CoordinatorTone;
  clicks: number;
  taskId?: string;
  outcome?: HuntOutcome;
}

export class HuntCoordinator {
  private activeCancel: (() => void) | null = null;
  /** Precise clock calibration shortly before a planned strike (see schedulePreciseCalibration). */
  private preciseTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSession: ArmedSession | null = null;
  private retired = false;
  private listeners: Set<(state: CoordinatorState) => void> = new Set();

  private state: CoordinatorState = {
    isArmed: false,
    targetTimestamp: null,
    targetSummary: null,
    statusText: "",
    tone: "idle",
    clicks: 0,
  };

  getState(): CoordinatorState {
    return { ...this.state };
  }

  isArmed(): boolean {
    return this.state.isArmed;
  }

  subscribe(listener: (state: CoordinatorState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private setState(partial: Partial<CoordinatorState>): void {
    this.state = { ...this.state, ...partial };
    const snap = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch {
        // ignore listener errors
      }
    }
  }

  /**
   * Returns current active armed session, if any.
   */
  getCurrentSession(): ArmedSession | null {
    return this.currentSession;
  }

  /**
   * Arm hunt for either manual HUD "Arm sniper" or background Scheduled task.
   * Guarantees that only ONE hunt engine instance runs at a time.
   */
  arm(params: {
    targetTimestamp: number;
    targetElement?: HTMLElement | null;
    descriptor?: UniversalTargetDescriptor | null;
    taskId?: string;
    label?: string;
    targetSlot?: string;
    customTime?: string;
    keyword?: string;
    clickProfileMode?: ClickProfileMode;
    dualDefenseReload?: boolean;
    preReloadLeadMs?: number;
    diagnostics?: TargetDiagnosticsSummary;
    /** Resuming after a reload: keep the session's token. */
    token?: string;
  }): void {
    if (this.state.isArmed && this.currentSession) {
      if (params.taskId && this.currentSession.taskId === params.taskId) {
        return;
      }
      // M3: If an active manually armed hunt already exists for the same target time,
      // adopt the taskId instead of cancelling and restarting the active hunt
      if (
        params.taskId &&
        !this.currentSession.taskId &&
        Math.abs(this.currentSession.targetTimestamp - params.targetTimestamp) <= 1000
      ) {
        this.currentSession.taskId = params.taskId;
        this.setState({ taskId: params.taskId });
        this.persistSession(this.currentSession);
        return;
      }
    }

    this.disarm(false); // cancel any existing active hunt first

    let desc = params.descriptor || null;
    let targetEl = params.targetElement || null;

    if (!desc && targetEl) {
      desc = elementResolver.describeUniversal(targetEl);
    }
    if (!targetEl && desc) {
      targetEl = elementResolver.relocateUniversal(desc);
    }

    if (!targetEl && !desc && !params.keyword) {
      console.warn("Cannot arm hunt: No target locked or specified");
      return;
    }

    // H6: Calculate effectiveReload respecting TargetDiagnostics strategy & user configuration
    let diag = params.diagnostics;
    if (!diag && targetEl) {
      try {
        diag = targetDiagnostics.inspect(targetEl);
      } catch {
        // ignore
      }
    }
    const adapter = getAdapterForUrl(typeof window !== "undefined" ? window.location.href : "");
    const shouldDisableReload = adapter?.shouldDisableReload?.() ?? false;
    const effectiveReload =
      shouldDisableReload || diag?.strategy === "reactive_no_reload"
        ? false
        : params.dualDefenseReload ?? (diag?.strategy === "static_dual_defense");

    // Pre-reload lead measured from this page's load times (lib/reload_timing), unless given.
    const preReloadLeadMs =
      params.preReloadLeadMs ?? reloadTiming.leadFor(typeof window !== "undefined" ? window.location.href : "");

    const session: ArmedSession = {
      targetTimestamp: params.targetTimestamp,
      taskId: params.taskId,
      label: params.label,
      targetSlot: params.targetSlot,
      customTime: params.customTime,
      descriptor: desc || undefined,
      keyword: params.keyword,
      clickProfileMode: params.clickProfileMode,
      dualDefenseReload: effectiveReload,
      // The user's switch as set in the HUD (shown again after a reload); the effective value above
      // can be off because the page does not need reloads.
      reloadSwitch: params.dualDefenseReload,
      preReloadLeadMs,
      diagnostics: diag || params.diagnostics,
      url: typeof window !== "undefined" ? window.location.href : "",
      armedAt: Date.now(),
      token: params.token ?? newSessionToken(),
    };
    this.currentSession = session;

    this.persistSession(session);

    const summary =
      params.label?.split("·")[1]?.trim() ||
      (desc?.initialText || desc?.id || "Target Button").slice(0, 40);

    this.setState({
      isArmed: true,
      targetTimestamp: params.targetTimestamp,
      targetSummary: summary,
      statusText: `Armed · ${summary}`,
      tone: "armed",
      clicks: 0,
      taskId: params.taskId,
      outcome: undefined,
    });

    this.schedulePreciseCalibration(params.targetTimestamp, adapter);

    this.activeCancel = startHunt({
      targetTimestamp: params.targetTimestamp,
      now: () => timeSyncClient.getServerTime(),
      locked: targetEl,
      universalDescriptor: desc ?? undefined,
      keyword: params.keyword,
      clickProfileMode: params.clickProfileMode,
      dualDefenseReload: effectiveReload,
      preReloadLeadMs,
      preFireLeadMs:
        (params as any).preFireLeadMs ??
        timeSyncClient.getRecommendedPreFireLeadMs(diag?.platformTier),
      platformTier: diag?.platformTier,
      windowMs:
        (params as any).windowMs ??
        adapter?.windowMs ??
        (diag?.platformTier === "speed_priority" ? HUNT_DEFAULTS.speedPriorityWindowMs : HUNT_DEFAULTS.windowMs),
      maxClicks:
        (params as any).maxClicks ??
        adapter?.maxClicks ??
        (diag?.platformTier === "speed_priority" ? HUNT_DEFAULTS.speedPriorityMaxClicks : undefined),
      onStatus: (msg) => {
        const isFiring = msg.includes("active") || msg.startsWith("Saving");
        const isWarning = msg.includes("Cloudflare") || msg.includes("Verify");
        this.setState({
          statusText: msg,
          tone: isWarning ? "warning" : isFiring ? "firing" : "armed",
        });
      },
      onDone: (outcome) => {
        this.handleDone(outcome);
      },
    });
  }

  /**
   * Directly arms a ScheduledTask triggered by background scheduler or auto-resume.
   */
  async armFromTask(task: ScheduledTask): Promise<void> {
    await timeSyncClient.init();
    const second = task.targetSecond ?? 0;
    const now = timeSyncClient.getServerTime();
    const targetTimestamp = task.targetAt ?? nextExactDropAt(
      task.targetHour,
      task.targetMinute,
      second,
      now
    );

    // H2: If past drop deadline grace window (15s), report missed (the background moves a daily task
    // on to its next drop) and abort arm. Tasks are written by the background only.
    if (now > targetTimestamp + 15_000) {
      // Expected (computer asleep / tab opened late), not an error: info, so it is not listed under
      // the extension's errors.
      console.info(`[HuntCoordinator] Task ${task.id} target time expired. Aborting arm.`);
      notifyBackground({
        action: MESSAGE_ACTIONS.TASK_STATUS_UPDATE,
        taskId: task.id,
        status: "missed",
        result: { result: "timeout", clicks: 0, detail: "Task deadline expired before arming" },
      });
      return;
    }

    // The button currently remembered for this page wins (it may have been picked again since)
    let desc = task.descriptor;
    if (typeof window !== "undefined") {
      try {
        const saved = await storage.getSavedTargetForUrl(window.location.href);
        if (saved) desc = saved.descriptor;
      } catch {
        // ignore
      }
    }

    let targetEl: HTMLElement | null = null;
    if (desc) {
      targetEl = elementResolver.relocateUniversal(desc);
    }

    this.arm({
      targetTimestamp,
      targetElement: targetEl,
      descriptor: desc,
      taskId: task.id,
      label: task.label,
      targetSlot: "custom",
      customTime: `${String(task.targetHour).padStart(2, "0")}:${String(task.targetMinute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
      keyword: task.keyword,
      clickProfileMode: task.clickProfileMode,
      dualDefenseReload: task.dualDefenseReload,
      diagnostics: task.diagnostics,
    });
  }

  /**
   * Resumes an armed session across a manual F5 or an emergency reload. sessionStorage (which the
   * page can write) only gives the token; the session itself comes from the extension's vault, so
   * a session forged or edited by the page is never resumed.
   */
  async checkAndResumeArmedSession(): Promise<boolean> {
    if (typeof sessionStorage === "undefined" || typeof window === "undefined") return false;
    let token = "";
    try {
      const raw = sessionStorage.getItem(ARMED_SESSION_KEY);
      if (!raw) return false;
      token = String(JSON.parse(raw)?.token || "");
    } catch {
      // unreadable: treated as no session
    }
    const session = await sessionVault.load<ArmedSession>(token);
    const now = timeSyncClient.getServerTime();
    if (!session || !isSamePageUrl(session.url, window.location.href) || now >= session.targetTimestamp + 15_000) {
      this.clearPersisted(token);
      return false;
    }
    const targetEl = session.descriptor ? elementResolver.relocateUniversal(session.descriptor) : null;
    this.arm({
      targetTimestamp: session.targetTimestamp,
      targetElement: targetEl,
      descriptor: session.descriptor,
      taskId: session.taskId,
      label: session.label,
      targetSlot: session.targetSlot,
      customTime: session.customTime,
      keyword: session.keyword,
      clickProfileMode: session.clickProfileMode,
      dualDefenseReload: session.reloadSwitch ?? session.dualDefenseReload,
      preReloadLeadMs: session.preReloadLeadMs,
      diagnostics: session.diagnostics,
      token: session.token,
    });
    return true;
  }

  /** Saves the session: the token (and a display copy) in sessionStorage, the session in the vault. */
  private persistSession(session: ArmedSession): void {
    try {
      sessionStorage.setItem(ARMED_SESSION_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      sessionVault.save(session.token, session).catch(() => {});
    }
  }

  private clearPersisted(token?: string): void {
    try {
      sessionStorage.removeItem(ARMED_SESSION_KEY);
    } catch {
      // ignore
    }
    if (token && typeof chrome !== "undefined" && chrome.storage?.local) {
      sessionVault.remove(token).catch(() => {});
    }
  }

  /**
   * A platform that plans its strike from the measured times (Caffiliate) gets a precise clock
   * calibration about 30 s before the drop: the strike plan is computed at T - 3.5 s from the
   * clock error, so a few ms instead of ~80 ms both moves the aim closer to 00:00 and removes the
   * offset's own bias. Other marketplaces are not probed again near the drop.
   */
  private schedulePreciseCalibration(targetTimestamp: number, adapter: ReturnType<typeof getAdapterForUrl>): void {
    this.clearPreciseTimer();
    if (!adapter?.planStrike) return;
    const run = () => {
      this.preciseTimer = null;
      timeSyncClient.calibratePrecise().catch(() => {});
    };
    const untilDrop = targetTimestamp - timeSyncClient.getServerTime();
    const delay = untilDrop - PRECISE_CALIBRATION_LEAD_MS;
    if (delay > 0) this.preciseTimer = setTimeout(run, delay);
    else if (untilDrop > 12_000) run(); // armed late: still time to finish before the plan at T - 3.5 s
  }

  private clearPreciseTimer(): void {
    if (this.preciseTimer) clearTimeout(this.preciseTimer);
    this.preciseTimer = null;
  }

  /**
   * Cancels the active hunt and optionally notifies background to cancel the task.
   */
  disarm(updateStorage = true): void {
    this.clearPreciseTimer();
    const taskId = this.currentSession?.taskId;
    const token = this.currentSession?.token;
    // A running engine reports the cancel itself (handleDone -> TASK_STATUS_UPDATE "cancelled")
    const reportedByEngine = Boolean(this.activeCancel);
    if (this.activeCancel) {
      this.activeCancel();
      this.activeCancel = null;
    }
    this.currentSession = null;

    this.clearPersisted(token);

    // Disarming a scheduled run cancels this run only (a daily task continues tomorrow); deleting the
    // task is done from the task list. The background owns the task list.
    if (updateStorage && taskId && !reportedByEngine) {
      notifyBackground({
        action: MESSAGE_ACTIONS.TASK_STATUS_UPDATE,
        taskId,
        status: "cancelled",
        result: { result: "cancelled", clicks: 0, detail: "Cancelled" },
      });
    }

    this.setState({
      isArmed: false,
      targetTimestamp: null,
      statusText: "Disarmed",
      tone: "idle",
      taskId: undefined,
      outcome: undefined,
    });
  }

  /**
   * Resets coordinator target, outcome and status completely when user forgets/clears target.
   * Cancels active hunt, removes sessionStorage and notifies listeners.
   */
  /**
   * The extension was reloaded and this script is orphaned: stop its hunt without touching the saved
   * session or reporting anything, so the new script (after a page reload or the popup reopening the
   * panel) resumes the same hunt from the vault instead of two scripts clicking.
   */
  retire(): void {
    this.retired = true;
    this.clearPreciseTimer();
    const cancel = this.activeCancel;
    this.activeCancel = null;
    this.currentSession = null;
    try {
      cancel?.();
    } catch {
      // the engine's own cleanup may touch the dead context
    }
  }

  clearTargetAndOutcome(): void {
    this.clearPreciseTimer();
    const token = this.currentSession?.token;
    if (this.activeCancel) {
      this.activeCancel();
      this.activeCancel = null;
    }
    this.currentSession = null;

    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.removeAttribute("data-dh-turnstile-challenge");
    }

    this.clearPersisted(token);

    this.setState({
      isArmed: false,
      targetTimestamp: null,
      targetSummary: null,
      statusText: "",
      tone: "idle",
      clicks: 0,
      taskId: undefined,
      outcome: undefined,
    });
  }

  /**
   * Resets finished outcome and status so that stale hunt results are not re-surfaced.
   */
  resetOutcome(): void {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.removeAttribute("data-dh-turnstile-challenge");
    }
    if (!this.state.isArmed) {
      this.setState({
        outcome: undefined,
        statusText: "",
        clicks: 0,
        tone: "idle",
      });
    }
  }

  private handleDone(outcome: HuntOutcome): void {
    if (this.retired) return;
    this.clearPreciseTimer();
    this.activeCancel = null;
    const taskId = this.currentSession?.taskId;
    const token = this.currentSession?.token;
    this.currentSession = null;
    this.clearPersisted(token);

    const tone: CoordinatorTone =
      outcome.result === "saved"
        ? "success"
        : outcome.result === "exhausted" || outcome.result === "timeout"
        ? "warning"
        : outcome.result === "cancelled"
        ? "idle"
        : "error";

    this.setState({
      isArmed: false,
      targetTimestamp: null,
      statusText: outcome.result === "cancelled" ? "Disarmed" : `${outcome.detail} (${outcome.clicks} clicks)`,
      tone,
      clicks: outcome.clicks,
      outcome,
    });

    if (taskId) {
      const status: TaskStatus =
        outcome.result === "saved"
          ? "completed"
          : outcome.result === "cancelled"
          ? "cancelled"
          : "failed";

      notifyBackground({
        action: MESSAGE_ACTIONS.TASK_STATUS_UPDATE,
        taskId,
        status,
        result: outcome,
      });
    }
  }
}

export const huntCoordinator = new HuntCoordinator();
