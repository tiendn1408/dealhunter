import { describe, it, expect, beforeEach, vi } from "vitest";
import { targetDiagnostics } from "./target_diagnostics";

describe("targetDiagnostics", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("detects React framework on an element or root", () => {
    const root = document.createElement("div");
    root.setAttribute("data-reactroot", "true");
    const btn = document.createElement("button");
    root.appendChild(btn);
    document.body.appendChild(root);

    const framework = targetDiagnostics.detectFramework(btn);
    expect(framework).toBe("react");
  });

  it("detects Vue framework when data-v- attribute is present", () => {
    const card = document.createElement("div");
    card.setAttribute("data-v-12345", "");
    const btn = document.createElement("button");
    card.appendChild(btn);
    document.body.appendChild(card);

    const framework = targetDiagnostics.detectFramework(btn);
    expect(framework).toBe("vue");
  });

  it("identifies in-DOM countdown snippets inside voucher containers", () => {
    const card = document.createElement("div");
    card.className = "voucher-card";
    card.innerHTML = `
      <div class="timer">Bắt đầu sau 00:04:30</div>
      <button id="save-btn" disabled>Sắp mở</button>
    `;
    document.body.appendChild(card);
    const btn = card.querySelector("#save-btn") as HTMLElement;

    const { snippet } = targetDiagnostics.findCountdownSnippet(btn);
    expect(snippet).toBe("00:04:30");
  });

  it("detects standby state from button disabled or semantic context", () => {
    const card = document.createElement("div");
    card.innerHTML = `<button id="btn1" disabled>Sắp mở</button>`;
    document.body.appendChild(card);

    const btn1 = card.querySelector("#btn1") as HTMLElement;
    expect(targetDiagnostics.isStandbyState(btn1)).toBe(true);

    const activeBtn = document.createElement("button");
    activeBtn.textContent = "Lưu ngay";
    document.body.appendChild(activeBtn);
    expect(targetDiagnostics.isStandbyState(activeBtn)).toBe(false);
  });

  it("diagnoses reactive_no_reload for voucher cards with live countdown timers", () => {
    const card = document.createElement("div");
    card.className = "voucher-card";
    card.innerHTML = `
      <span class="countdown">00:01:25</span>
      <button id="voucher-btn">Nhắc tôi</button>
    `;
    document.body.appendChild(card);
    const btn = card.querySelector("#voucher-btn") as HTMLElement;

    const result = targetDiagnostics.inspect(btn);
    expect(result.hasCountdownTimer).toBe(true);
    expect(result.countdownSnippet).toBe("00:01:25");
    expect(result.strategy).toBe("reactive_no_reload");
  });

  it("diagnoses static_dual_defense for plain static elements without timer or framework", () => {
    const btn = document.createElement("button");
    btn.textContent = "Mua vé";
    document.body.appendChild(btn);

    const result = targetDiagnostics.inspect(btn);
    expect(result.hasCountdownTimer).toBe(false);
    expect(result.framework).toBe("unknown");
    expect(result.strategy).toBe("static_dual_defense");
  });

  it("confirms timer ticking when countdown numbers change over time", async () => {
    const card = document.createElement("div");
    card.className = "voucher-card";
    card.innerHTML = `
      <span class="countdown">00:00:10</span>
      <button id="voucher-btn">Sắp mở</button>
    `;
    document.body.appendChild(card);
    const btn = card.querySelector("#voucher-btn") as HTMLElement;
    const timerSpan = card.querySelector(".countdown") as HTMLElement;

    // Simulate countdown tick after 50ms
    setTimeout(() => {
      timerSpan.textContent = "00:00:09";
    }, 50);

    const ticking = await targetDiagnostics.sampleTicking(btn, 100);
    expect(ticking).toBe(true);
  });
});
