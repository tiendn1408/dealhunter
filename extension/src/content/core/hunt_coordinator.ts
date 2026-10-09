import { startHunt, HuntOutcome } from "./hunt_engine";
import { elementResolver, UniversalTargetDescriptor } from "./element_resolver";
import { timeSyncClient } from "./time_sync_client";
import { ClickProfileMode } from "./human_biometrics";
import { storage } from "../../lib/storage";
import { MESSAGE_ACTIONS } from "../../lib/constants";
import { ScheduledTask, TaskStatus, TargetDiagnosticsSummary } from "../../lib/types";
import { nextExactDropAt } from "../../lib/drop_time";
import { isSamePageUrl } from "../../lib/url";

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
  diagnostics?: TargetDiagnosticsSummary;
  url: string;
  armedAt: number;
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
  private currentSession: ArmedSession | null = null;
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
    diagnostics?: TargetDiagnosticsSummary;
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
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem(ARMED_SESSION_KEY, JSON.stringify(this.currentSession));
          } catch {
            // ignore
          }
        }
        return;
      }
    }

    this.disarm(false); // cancel any existing active hunt first

    const now = timeSyncClient.getServerTime();
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
    const effectiveReload =
      params.diagnostics?.strategy === "reactive_no_reload"
        ? false
        : params.dualDefenseReload ?? true;

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
      diagnostics: params.diagnostics,
      url: typeof window !== "undefined" ? window.location.href : "",
      armedAt: Date.now(),
    };
    this.currentSession = session;

    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.setItem(ARMED_SESSION_KEY, JSON.stringify(session));
      } catch {
        // ignore
      }
    }

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

    this.activeCancel = startHunt({
      targetTimestamp: params.targetTimestamp,
      now: () => timeSyncClient.getServerTime(),
      locked: targetEl,
      universalDescriptor: desc ?? undefined,
      keyword: params.keyword,
      clickProfileMode: params.clickProfileMode,
      dualDefenseReload: effectiveReload,
      onStatus: (msg) => {
        const isFiring = msg.includes("active") || msg.startsWith("Saving");
        this.setState({
          statusText: msg,
          tone: isFiring ? "firing" : "armed",
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

    // H2: If past drop deadline grace window (15s), mark missed and abort arm
    if (now > targetTimestamp + 15_000) {
      console.warn(`[HuntCoordinator] Task ${task.id} target time expired. Aborting arm.`);
      await storage.updateTaskStatus(task.id, "missed", {
        result: "timeout",
        clicks: 0,
        detail: "Task deadline expired before arming",
        finishedAt: now,
      });
      return;
    }

    let desc = task.descriptor;
    if (!desc && typeof window !== "undefined") {
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
   * Resumes an armed session preserved in sessionStorage across manual F5 or emergency reload.
   */
  checkAndResumeArmedSession(): boolean {
    if (typeof sessionStorage === "undefined" || typeof window === "undefined") return false;
    try {
      const raw = sessionStorage.getItem(ARMED_SESSION_KEY);
      if (!raw) return false;
      const session: ArmedSession = JSON.parse(raw);
      const now = timeSyncClient.getServerTime();

      if (isSamePageUrl(session.url, window.location.href) && now < session.targetTimestamp + 15_000) {
        let targetEl: HTMLElement | null = null;
        if (session.descriptor) {
          targetEl = elementResolver.relocateUniversal(session.descriptor);
        }
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
          dualDefenseReload: session.dualDefenseReload,
          diagnostics: session.diagnostics,
        });
        return true;
      } else {
        sessionStorage.removeItem(ARMED_SESSION_KEY);
      }
    } catch {
      // ignore
    }
    return false;
  }

  /**
   * Cancels the active hunt and optionally notifies background to cancel the task.
   */
  disarm(updateStorage = true): void {
    const taskId = this.currentSession?.taskId;
    if (this.activeCancel) {
      this.activeCancel();
      this.activeCancel = null;
    }
    this.currentSession = null;

    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.removeItem(ARMED_SESSION_KEY);
      } catch {
        // ignore
      }
    }

    if (updateStorage && taskId && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.CANCEL_TASK, taskId }).catch(() => {});
      storage.updateTaskStatus(taskId, "cancelled").catch(() => {});
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

  private handleDone(outcome: HuntOutcome): void {
    this.activeCancel = null;
    const taskId = this.currentSession?.taskId;
    this.currentSession = null;

    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.removeItem(ARMED_SESSION_KEY);
      } catch {
        // ignore
      }
    }

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

    if (taskId && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      const status: TaskStatus =
        outcome.result === "saved"
          ? "completed"
          : outcome.result === "cancelled"
          ? "cancelled"
          : "failed";

      chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.TASK_STATUS_UPDATE,
        taskId,
        status,
        result: outcome,
      }).catch(() => {});
    }
  }
}

export const huntCoordinator = new HuntCoordinator();
