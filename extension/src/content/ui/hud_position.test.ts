import { describe, it, expect } from "vitest";
import { anchorFromRect, applyAnchor, clampAnchor } from "./hud_position";

// The hunt panel stays in the screen corner the user dragged it to, also when it is minimized to
// the pill (smaller) or expanded again (taller).

describe("hunt panel position", () => {
  const vw = 1440;
  const vh = 900;

  it("anchors to the nearest corner where it was dropped", () => {
    expect(anchorFromRect({ left: 1060, top: 400, width: 356, height: 480 }, vw, vh)).toEqual({ side: "right", x: 24, edge: "bottom", y: 20 });
    expect(anchorFromRect({ left: 30, top: 40, width: 356, height: 480 }, vw, vh)).toEqual({ side: "left", x: 30, edge: "top", y: 40 });
  });

  it("minimized pill keeps the corner: bottom-right stays bottom-right", () => {
    const el = document.createElement("div");
    applyAnchor(el, { side: "right", x: 24, edge: "bottom", y: 20 });
    expect(el.style.getPropertyValue("right")).toBe("24px");
    expect(el.style.getPropertyValue("bottom")).toBe("20px");
    expect(el.style.getPropertyValue("left")).toBe("auto");
    expect(el.style.getPropertyValue("top")).toBe("auto");
  });

  it("a pill dropped near the top expands into a panel that still fits on screen", () => {
    const pillAnchor = anchorFromRect({ left: 1200, top: 600, width: 160, height: 40 }, vw, vh);
    expect(pillAnchor.edge).toBe("bottom");
    const fitted = clampAnchor({ side: "right", x: 24, edge: "bottom", y: 700 }, 356, 480, vw, vh);
    expect(fitted.y).toBe(vh - 480 - 8);
  });
});
