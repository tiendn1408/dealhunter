import { describe, it, expect } from "vitest";
import { buttonName } from "./button_name";

describe("name of the chosen button", () => {
  const el = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
  };

  it("uses the button text", () => {
    expect(buttonName(el(`<button>Lưu</button>`))).toBe("Lưu");
  });

  it("an icon-only button is named by its label, not by the symbol", () => {
    expect(buttonName(el(`<button aria-label="Mở menu">≣</button>`), "≣")).toBe("Mở menu");
    expect(buttonName(el(`<button><svg><title>Đóng</title></svg></button>`))).toBe("Đóng");
    expect(buttonName(el(`<button><img alt="Nhận quà" src="x.png"></button>`))).toBe("Nhận quà");
  });

  it("nothing readable: empty, so the default name is shown", () => {
    expect(buttonName(el(`<button>≣</button>`), "≣")).toBe("");
  });
});
