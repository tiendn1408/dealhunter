import { describe, it, expect, beforeEach } from "vitest";
import { ElementResolver } from "./element_resolver";

describe("ElementResolver", () => {
  let resolver: ElementResolver;

  beforeEach(() => {
    resolver = new ElementResolver();
    document.body.innerHTML = "";
  });

  it("identifies collect buttons by standard Vietnamese text", () => {
    document.body.innerHTML = `
      <div>
        <button id="btn1">Lưu</button>
        <button id="btn2">Lưu mã</button>
        <button id="btn3">Thu thập</button>
        <button id="btn4">Lưu ngay</button>
        <button id="btn5">Thu thập ngay</button>
        <button id="btn6">Đã lưu</button>
        <button id="btn7">Hết lượt</button>
        <button id="btn8">Xem chi tiết</button>
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

    // A disabled button on a card that says it ran out is exhausted
    const card = document.createElement("div");
    card.className = "voucher-card";
    card.innerHTML = `<span>Giảm 50k</span><span>Đã hết</span><button disabled>Lưu</button>`;
    document.body.appendChild(card);
    expect(resolver.getButtonState(card.querySelector("button"))).toBe("exhausted");

    const btnReady = document.createElement("button");
    btnReady.innerText = "Lưu";
    document.body.appendChild(btnReady);
    expect(resolver.isButtonFinished(btnReady)).toBe(false);
  });
});
