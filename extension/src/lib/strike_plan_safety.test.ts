import { describe, it, expect } from "vitest";
import { planStrike, STRIKE_PLAN } from "./strike_plan";

// Whatever the history holds (a stuck tab, a missing measurement, a slow network night), the plan
// must stay sane: start between 0 and MAX_LEAD_MS before 00:00, never after it (the 17/10 night
// started at 00:00:06 from one 7864 ms sample), attempts in order, and token-bound receipts after 00:00.
function expectSane(plan: ReturnType<typeof planStrike>) {
  expect(Number.isFinite(plan.leadMs)).toBe(true);
  expect(plan.leadMs).toBeGreaterThanOrEqual(0);
  expect(plan.leadMs).toBeLessThanOrEqual(STRIKE_PLAN.MAX_LEAD_MS);
  expect(plan.offsetsMs[0]).toBe(0);
  for (let i = 1; i < plan.offsetsMs.length; i++) expect(plan.offsetsMs[i]).toBeGreaterThan(plan.offsetsMs[i - 1]);
  expect(plan.arrivalsMs.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(plan.sigmaMs)).toBe(true);
  if (plan.tokenBound) expect(plan.arrivalsMs[0]).toBeGreaterThan(0);
}

describe("strike plan safety on bad history", () => {
  it("17/10 night: one stuck run (7864 ms) among normal ones does not push the start past 00:00", () => {
    const plan = planStrike({ rttMs: 74, clockErrorMs: 20, prepSamplesMs: [1522, 1571, 7864], serverSamplesMs: [186, 418] });
    expectSane(plan);
    expect(plan.leadMs).toBeGreaterThan(1000);
    expect(plan.arrivalsMs[0]).toBeLessThan(400);
  });

  it("a stuck run among four normal ones changes almost nothing", () => {
    const clean = planStrike({ rttMs: 76, clockErrorMs: 6, prepSamplesMs: [1494, 1522, 1571, 1625] });
    const dirty = planStrike({ rttMs: 76, clockErrorMs: 6, prepSamplesMs: [1494, 1522, 1571, 1625, 7864] });
    expectSane(dirty);
    expect(Math.abs(dirty.arrivalsMs[0] - clean.arrivalsMs[0])).toBeLessThan(60);
  });

  it("tonight's inputs with a precise clock: aim ~+80 ms, start ~1.5 s before", () => {
    const plan = planStrike({ rttMs: 76, clockErrorMs: 6, prepSamplesMs: [1494, 1522, 1571, 1625], serverSamplesMs: [186, 418, 224, 207] });
    expectSane(plan);
    expect(plan.tokenBound).toBe(true);
    expect(plan.arrivalsMs[0]).toBeGreaterThanOrEqual(60);
    expect(plan.arrivalsMs[0]).toBeLessThanOrEqual(100);
    expect(plan.leadMs).toBeGreaterThan(1400);
    expect(plan.leadMs).toBeLessThan(1600);
  });

  it.each([
    ["no history, no network measure", { rttMs: 0, clockErrorMs: 1000, prepSamplesMs: [] }],
    ["uncalibrated clock", { rttMs: 76, clockErrorMs: 1000, prepSamplesMs: [1494, 1522, 1571, 1625] }],
    ["only stuck runs", { rttMs: 76, clockErrorMs: 20, prepSamplesMs: [7864, 9000] }],
    ["zeros and negatives", { rttMs: 76, clockErrorMs: 20, prepSamplesMs: [0, -5, 1500] }],
    ["huge clock error", { rttMs: 76, clockErrorMs: 1e9, prepSamplesMs: [1500, 1550] }],
    ["slow network", { rttMs: 900, clockErrorMs: 20, prepSamplesMs: [1500, 1550], serverSamplesMs: [2500, 3000] }],
    ["NaN in history", { rttMs: 76, clockErrorMs: 20, prepSamplesMs: [NaN, 1500, Infinity, 1550] }],
  ])("%s: stays sane", (_name, inputs) => {
    expectSane(planStrike(inputs as never));
  });

  it("random histories never give an insane plan", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 2000; i++) {
      const n = Math.floor(rnd() * 8);
      const prep = Array.from({ length: n }, () => (rnd() < 0.15 ? rnd() * 12000 : 1300 + rnd() * 400));
      const server = Array.from({ length: Math.floor(rnd() * 6) }, () => rnd() * 1500);
      expectSane(planStrike({ rttMs: rnd() * 300, clockErrorMs: rnd() * 200, prepSamplesMs: prep, serverSamplesMs: server }));
    }
  });
});
