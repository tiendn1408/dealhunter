import { describe, it, expect } from "vitest";
import { normalQuantile, planStrike, STRIKE_PLAN } from "./strike_plan";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("planStrike", () => {
  it("normalQuantile matches the standard normal table", () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.8413)).toBeCloseTo(1, 3);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.96, 2);
    expect(normalQuantile(0.99)).toBeCloseTo(2.326, 2);
  });

  it("plans at least 5 attempts, ascending, at least MIN_GAP_MS apart, first at offset 0", () => {
    const plan = planStrike({ rttMs: 80, clockErrorMs: 20, prepSamplesMs: [800, 820, 790, 850] });
    expect(plan.offsetsMs.length).toBeGreaterThanOrEqual(5);
    expect(plan.offsetsMs[0]).toBe(0);
    for (let i = 1; i < plan.offsetsMs.length; i++) {
      expect(plan.offsetsMs[i] - plan.offsetsMs[i - 1]).toBeGreaterThanOrEqual(STRIKE_PLAN.MIN_GAP_MS - 1);
    }
  });

  it("starts early by the measured prep + one-way time so requests reach the server around 00:00", () => {
    const plan = planStrike({ rttMs: 100, clockErrorMs: 30, prepSamplesMs: [800, 810, 790, 805, 795] });
    expect(plan.prepMs).toBe(800);
    expect(plan.oneWayMs).toBe(50);
    // first start = T - lead; its arrival = start + prep + oneWay
    expect(-plan.leadMs + plan.prepMs + plan.oneWayMs).toBeCloseTo(plan.arrivalsMs[0], -1);
    // arrivals straddle 00:00, centred slightly after it
    expect(plan.arrivalsMs[0]).toBeLessThan(0);
    expect(plan.arrivalsMs[plan.arrivalsMs.length - 1]).toBeGreaterThan(0);
    expect(median(plan.arrivalsMs)).toBeGreaterThanOrEqual(0);
    expect(plan.leadMs).toBeGreaterThan(800);
  });

  it("widens the spread and adds attempts when the clock or the prep time is uncertain", () => {
    const tight = planStrike({ rttMs: 40, clockErrorMs: 5, prepSamplesMs: [500, 502, 498, 501] });
    const loose = planStrike({ rttMs: 40, clockErrorMs: 200, prepSamplesMs: [300, 900, 500, 700] });
    expect(loose.sigmaMs).toBeGreaterThan(tight.sigmaMs);
    expect(loose.offsetsMs.length).toBeGreaterThan(tight.offsetsMs.length);
    expect(loose.offsetsMs.length).toBeLessThanOrEqual(STRIKE_PLAN.MAX_ATTEMPTS);
    const span = (p: typeof tight) => p.arrivalsMs[p.arrivalsMs.length - 1] - p.arrivalsMs[0];
    expect(span(loose)).toBeGreaterThan(span(tight));
  });

  it("without history it only compensates the network, and never starts more than MAX_LEAD_MS early", () => {
    const fresh = planStrike({ rttMs: 0, clockErrorMs: 1000, prepSamplesMs: [] });
    expect(fresh.prepMs).toBe(0);
    expect(fresh.oneWayMs).toBe(STRIKE_PLAN.UNKNOWN_ONE_WAY_MS);
    expect(fresh.offsetsMs.length).toBeGreaterThanOrEqual(5);

    const slow = planStrike({ rttMs: 400, clockErrorMs: 1000, prepSamplesMs: [5000, 5200, 4900, 5100] });
    expect(slow.leadMs).toBeLessThanOrEqual(STRIKE_PLAN.MAX_LEAD_MS);
  });
});
