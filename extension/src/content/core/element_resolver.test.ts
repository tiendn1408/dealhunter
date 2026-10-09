import { describe, it, expect, beforeEach } from "vitest";
import { ElementResolver, checkPageToastConfirmation, matchesTokens } from "./element_resolver";

describe("ElementResolver", () => {
  let resolver: ElementResolver;

  beforeEach(() => {
    resolver = new ElementResolver();
    document.body.innerHTML = "";
  });

  it("identifies collect buttons and filters out saved, depleted, and secondary detail elements", () => {
    document.body.innerHTML = `
      <div>
        <button id="btn1">Lưu</button>
        <button id="btn2">Lưu mã</button>
        <button id="btn3">Thu thập</button>
        <button id="btn4">Lưu ngay</button>
        <button id="btn5">Thu thập ngay</button>
        <button id="btn6" aria-pressed="true">Đã lưu</button>
        <button id="btn7" class="sold-out" disabled>Hết lượt</button>
        <button id="btn8" class="btn-detail" aria-haspopup="dialog">Xem chi tiết</button>
      </div>
    `;

    const buttons = resolver.findCollectButtons();
    expect(buttons.length).toBe(5);
    const ids = buttons.map((b) => b.id);
    expect(ids).toEqual(["btn1", "btn2", "btn3", "btn4", "btn5"]);
  });

  it("filters buttons by keyword in parent container", () => {
    document.body.innerHTML = `
      <div class="voucher-card" id="card1">
        <span>Giam 15% toi da 500k</span>
        <button id="btn1">Lưu</button>
      </div>
      <div class="voucher-card" id="card2">
        <span>Freeship Extra</span>
        <button id="btn2">Lưu</button>
      </div>
    `;

    const filtered = resolver.findCollectButtons("500k");
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("btn1");
  });

  it("detects finished state correctly", () => {
    const btnSaved = document.createElement("button");
    btnSaved.setAttribute("aria-pressed", "true");
    btnSaved.innerText = "Đã lưu";
    document.body.appendChild(btnSaved);
    expect(resolver.isButtonFinished(btnSaved)).toBe(true);

    // Before the drop Shopee shows a disabled "Lưu": that is NOT finished, the hunt must keep waiting
    const btnDisabled = document.createElement("button");
    btnDisabled.innerText = "Lưu";
    btnDisabled.setAttribute("disabled", "true");
    document.body.appendChild(btnDisabled);
    expect(resolver.isButtonFinished(btnDisabled)).toBe(false);
    expect(resolver.getButtonState(btnDisabled)).toBe("unknown");

    // A disabled button on a card that has exhausted class is exhausted
    const card = document.createElement("div");
    card.className = "voucher-card exhausted";
    card.innerHTML = `<span>Giảm 50k</span><span>Đã hết</span><button disabled>Lưu</button>`;
    document.body.appendChild(card);
    expect(resolver.getButtonState(card.querySelector("button"))).toBe("exhausted");

    const btnReady = document.createElement("button");
    btnReady.innerText = "Lưu";
    document.body.appendChild(btnReady);
    expect(resolver.isButtonFinished(btnReady)).toBe(false);
  });

  it("relocates arbitrary elements across re-render using universal fingerprinting", () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="user-checkin-card">
          <h3>Điểm danh nhận quà 00:00</h3>
          <button id="checkin-btn" data-testid="daily-checkin" role="button">Điểm danh</button>
        </div>
      </div>
    `;

    const originalBtn = document.getElementById("checkin-btn")!;
    const desc = resolver.describeUniversal(originalBtn);
    expect(desc.id).toBe("checkin-btn");
    expect(desc.initialText).toBe("Điểm danh");
    expect(desc.attributes["data-testid"]).toBe("daily-checkin");

    // Simulate React re-render: DOM is replaced with new nodes
    document.body.innerHTML = `
      <div id="app">
        <div class="user-checkin-card">
          <h3>Điểm danh nhận quà 00:00</h3>
          <button id="checkin-btn-fresh" data-testid="daily-checkin" role="button">Điểm danh</button>
        </div>
      </div>
    `;

    const relocated = resolver.relocateUniversal(desc);
    expect(relocated).not.toBeNull();
    expect(relocated?.getAttribute("data-testid")).toBe("daily-checkin");
  });

  it("detects ARIA, class-based, and behavioral completion via isTargetCompleted", () => {
    // ARIA pressed
    const ariaBtn = document.createElement("button");
    ariaBtn.setAttribute("aria-pressed", "true");
    ariaBtn.innerText = "Claimed";
    document.body.appendChild(ariaBtn);
    expect(resolver.isTargetCompleted(ariaBtn).completed).toBe(true);
    expect(resolver.isTargetCompleted(ariaBtn).state).toBe("saved");

    // Data-state checked
    const dataBtn = document.createElement("button");
    dataBtn.setAttribute("data-state", "checked");
    dataBtn.innerText = "獲得済み";
    document.body.appendChild(dataBtn);
    expect(resolver.isTargetCompleted(dataBtn).completed).toBe(true);
    expect(resolver.isTargetCompleted(dataBtn).state).toBe("saved");

    // CSS class completion
    const classBtn = document.createElement("button");
    classBtn.className = "btn-saved is-success";
    classBtn.innerText = "Đã điểm danh";
    document.body.appendChild(classBtn);
    expect(resolver.isTargetCompleted(classBtn).completed).toBe(true);

    // Button became disabled after click
    const clickedBtn = document.createElement("button");
    clickedBtn.innerText = "Check in";
    clickedBtn.setAttribute("disabled", "true");
    document.body.appendChild(clickedBtn);
    // Before click (clicks = 0): should NOT be completed
    expect(resolver.isTargetCompleted(clickedBtn, "Check in", 0).completed).toBe(false);
    // After click (clicks = 1): should be marked completed
    expect(resolver.isTargetCompleted(clickedBtn, "Check in", 1).completed).toBe(true);
    expect(resolver.isTargetCompleted(clickedBtn, "Check in", 1).state).toBe("saved");

    // Button text mutated after click
    const textChangedBtn = document.createElement("button");
    textChangedBtn.innerText = "1/1 Done";
    document.body.appendChild(textChangedBtn);
    expect(resolver.isTargetCompleted(textChangedBtn, "Điểm danh ngay", 1).completed).toBe(true);
    expect(resolver.isTargetCompleted(textChangedBtn, "Điểm danh ngay", 1).state).toBe("saved");
  });

  it("relocates checkin buttons even when container has coin numbers/value tokens", () => {
    document.body.innerHTML = `
      <div class="mission-item">
        <div class="reward-title">Điểm danh nhận +100 xu mỗi ngày</div>
        <div class="reward-desc">Chuỗi điểm danh: Ngày 1</div>
        <div class="btn-wrap">
          <button class="btn-claim-today">Điểm danh</button>
        </div>
      </div>
    `;

    const originalBtn = document.querySelector<HTMLElement>(".btn-claim-today")!;
    const desc = resolver.describeUniversal(originalBtn);
    expect(desc.initialText).toBe("Điểm danh");
    expect(desc.valueTokens?.length).toBeGreaterThan(0); // contains 100xu, 1

    // Simulate page reload or React state update: class names mutated, DOM reconstructed
    document.body.innerHTML = `
      <div class="mission-item">
        <div class="reward-title">Điểm danh nhận +100 xu mỗi ngày</div>
        <div class="reward-desc">Chuỗi điểm danh: Ngày 1</div>
        <div class="btn-wrap">
          <button class="btn-active-new">Điểm danh</button>
        </div>
      </div>
    `;

    const relocated = resolver.relocateUniversal(desc);
    expect(relocated).not.toBeNull();
    expect(relocated?.className).toBe("btn-active-new");
    expect(relocated?.innerText).toBe("Điểm danh");
  });

  it("C1-c: does not misidentify ticket or checkout icon as success/check", () => {
    const ticketBtn = document.createElement("button");
    ticketBtn.innerHTML = '<i class="icon-ticket"></i> Mua vé';
    document.body.appendChild(ticketBtn);
    expect(resolver.isTargetCompleted(ticketBtn, "Mua vé", 1).completed).toBe(false);

    const checkoutBtn = document.createElement("button");
    checkoutBtn.innerHTML = '<svg class="checkout-icon"></svg> Checkout';
    document.body.appendChild(checkoutBtn);
    expect(resolver.isTargetCompleted(checkoutBtn, "Checkout", 1).completed).toBe(false);
  });

  it("C1-d: does not mark as saved simply because node was removed from DOM", () => {
    const btn = document.createElement("button");
    btn.innerText = "Lưu";
    document.body.appendChild(btn);
    // Simulate node removal (e.g. redirected or unmounted during re-render)
    btn.remove();
    const status = resolver.isTargetCompleted(btn, "Lưu", 1);
    expect(status.completed).toBe(false);
    expect(status.state).not.toBe("saved");
  });

  it("C2: relocateUniversal does not pick another button when original card was removed", () => {
    document.body.innerHTML = `
      <div class="voucher-card" id="card-1">
        <span>Giảm 50k đơn 500k</span>
        <button class="btn-collect">Lưu</button>
      </div>
      <div class="voucher-card" id="card-2">
        <span>Giảm 20k đơn 200k</span>
        <button class="btn-collect">Lưu</button>
      </div>
    `;
    const btn1 = document.querySelector("#card-1 button") as HTMLElement;
    const desc1 = resolver.describeUniversal(btn1);

    // Now simulate card-1 disappears (consumed or expired), leaving only card-2:
    document.body.innerHTML = `
      <div class="voucher-card" id="card-2">
        <span>Giảm 20k đơn 200k</span>
        <button class="btn-collect">Lưu</button>
      </div>
    `;

    const relocated = resolver.relocateUniversal(desc1);
    // Must NOT match card-2 because its valueTokens and card content are completely different!
    expect(relocated).toBeNull();
  });

  it("C2: relocateUniversal does not pick another button when card index shifts without ID", () => {
    document.body.innerHTML = `
      <div class="voucher-list">
        <div class="voucher-card">
          <span>Giảm 50k đơn 500k</span>
          <button class="btn-collect">Lưu</button>
        </div>
        <div class="voucher-card">
          <span>Giảm 20k đơn 200k</span>
          <button class="btn-collect">Lưu</button>
        </div>
      </div>
    `;
    const btn1 = document.querySelector(".voucher-card button") as HTMLElement;
    const desc1 = resolver.describeUniversal(btn1);

    // Card 1 disappears, card 2 is now :nth-of-type(1):
    document.body.innerHTML = `
      <div class="voucher-list">
        <div class="voucher-card">
          <span>Giảm 20k đơn 200k</span>
          <button class="btn-collect">Lưu</button>
        </div>
      </div>
    `;

    const relocated = resolver.relocateUniversal(desc1);
    expect(relocated).toBeNull();
  });

  it("M10: button with data-state='active' is not considered completed/saved", () => {
    const tabBtn = document.createElement("button");
    tabBtn.setAttribute("data-state", "active");
    tabBtn.innerText = "Tab 1";
    document.body.appendChild(tabBtn);

    const check = resolver.isTargetCompleted(tabBtn, "Tab 1", 1);
    expect(check.completed).toBe(false);
    expect(check.state).not.toBe("saved");
  });

  it("detects page toast notification confirming voucher saved after click", () => {
    const btn = document.createElement("button");
    btn.innerText = "Lưu";
    document.body.appendChild(btn);

    // Create a Shopee toast element
    const toast = document.createElement("div");
    toast.className = "shopee-toast";
    toast.innerText = "Đã lưu voucher vào ví";
    document.body.appendChild(toast);

    const check = resolver.isTargetCompleted(btn, "Lưu", 1);
    expect(check.completed).toBe(true);
    expect(check.state).toBe("saved");
    expect(check.reason).toContain("Page toast notification confirmed success");
  });

  it("detects page toast notification confirming voucher exhausted after click", () => {
    const btn = document.createElement("button");
    btn.innerText = "Lưu";
    document.body.appendChild(btn);

    const toast = document.createElement("div");
    toast.setAttribute("role", "alert");
    toast.innerText = "Mã voucher đã hết lượt sử dụng";
    document.body.appendChild(toast);

    const check = resolver.isTargetCompleted(btn, "Lưu", 1);
    expect(check.completed).toBe(true);
    expect(check.state).toBe("exhausted");
    expect(check.reason).toContain("Page toast notification confirmed exhausted");
  });

  it("strictly ignores DealHunter HUD elements when scanning for toasts", () => {
    const btn = document.createElement("button");
    btn.innerText = "Lưu";
    document.body.appendChild(btn);

    // DealHunter's own HUD containing "saved"
    const hud = document.createElement("div");
    hud.id = "dealhunter-hud-root";
    hud.innerHTML = '<div class="dh-status" role="status">Saved target</div>';
    document.body.appendChild(hud);

    const toastCheck = checkPageToastConfirmation();
    expect(toastCheck).toBeNull();
  });

  it("matchesTokens handles stock percentage badges added to voucher card at drop", () => {
    const wanted = new Set(["50k", "500k"]);
    // Candidate card added progress "Còn 80%" at drop
    const candidateWithStock = new Set(["50k", "500k", "80%"]);
    expect(matchesTokens(wanted, candidateWithStock)).toBe(true);

    // Completely different voucher should not match
    const differentCard = new Set(["20k", "200k"]);
    expect(matchesTokens(wanted, differentCard)).toBe(false);
  });

  it("describeUniversal includes documentTop offset for scroll restoration", () => {
    const btn = document.createElement("button");
    btn.innerText = "Lưu mã";
    document.body.appendChild(btn);

    const desc = resolver.describeUniversal(btn);
    expect(typeof desc.documentTop).toBe("number");
  });
});
