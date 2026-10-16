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
    const plan = planStrike({ rttMs: 100, clockErrorMs: 30, prepSamplesMs: [200, 210, 190, 205, 195] });
    expect(plan.tokenBound).toBe(false);
    expect(plan.prepMs).toBe(200);
    expect(plan.oneWayMs).toBe(50);
    // first start = T - lead; its arrival = start + prep + oneWay
    expect(-plan.leadMs + plan.prepMs + plan.oneWayMs).toBeCloseTo(plan.arrivalsMs[0], -1);
    // arrivals straddle 00:00, centred slightly after it
    expect(plan.arrivalsMs[0]).toBeLessThan(0);
    expect(plan.arrivalsMs[plan.arrivalsMs.length - 1]).toBeGreaterThan(0);
    expect(median(plan.arrivalsMs)).toBeGreaterThanOrEqual(0);
    expect(plan.leadMs).toBeGreaterThan(200);
  });

  it("widens the spread and adds attempts when the clock or the prep time is uncertain", () => {
    const tight = planStrike({ rttMs: 40, clockErrorMs: 5, prepSamplesMs: [100, 102, 98, 101] });
    const loose = planStrike({ rttMs: 40, clockErrorMs: 200, prepSamplesMs: [50, 250, 100, 200] });
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

  // 13/10 night: the first attempt waited 1571 ms for its Turnstile token and the server answered
  // in 186 ms (it verifies the token with Cloudflare first); the plan had assumed 0 ms and 39 ms.
  it("token-bound: the first receipt lands after 00:00, never before (an early one burns the token)", () => {
    const plan = planStrike({ rttMs: 78, clockErrorMs: 20, prepSamplesMs: [1571], serverSamplesMs: [186] });
    expect(plan.tokenBound).toBe(true);
    expect(plan.prepMs).toBe(1571);
    expect(plan.oneWayMs).toBe(39); // the receipt: request sent + one-way network
    expect(plan.arrivalsMs[0]).toBeGreaterThan(0);
    expect(plan.arrivalsMs[0]).toBeGreaterThanOrEqual(plan.sigmaMs * STRIKE_PLAN.TOKEN_SAFE_SIGMAS - 1);
    expect(plan.arrivalsMs.every((a, i) => i === 0 || a - plan.arrivalsMs[i - 1] === STRIKE_PLAN.MIN_GAP_MS)).toBe(true);
    expect(plan.leadMs).toBe(Math.round(plan.prepMs + plan.oneWayMs - plan.arrivalsMs[0]));
    expect(plan.leadMs).toBeLessThanOrEqual(STRIKE_PLAN.MAX_LEAD_MS);
  });

  // 15/10 night: second measurement 1522 ms (the first was 1571 ms); the server took 418 ms on a busy
  // night. With one sample the plan assumed a 393 ms spread and aimed 395 ms after 00:00; the request
  // left at 00:00:00.207. Two close measurements now give a ~50 ms spread.
  it("two close token times shrink the margin from ~395 ms to under 100 ms after 00:00", () => {
    const night2 = planStrike({ rttMs: 78, clockErrorMs: 20, prepSamplesMs: [1571], serverSamplesMs: [186] });
    const night3 = planStrike({ rttMs: 78, clockErrorMs: 20, prepSamplesMs: [1571, 1522], serverSamplesMs: [186, 418] });
    expect(night3.prepMs).toBe(1547);
    expect(night3.arrivalsMs[0]).toBeGreaterThan(0);
    expect(night3.arrivalsMs[0]).toBeLessThan(100);
    expect(night3.arrivalsMs[0]).toBeLessThan(night2.arrivalsMs[0]);
    // the request leaves after 00:00 minus the one-way time, so it reaches the server after 00:00
    const sentAt = -night3.leadMs + night3.prepMs;
    expect(sentAt + night3.oneWayMs).toBeGreaterThan(0);
  });

  it("a slow server night does not push the receipt later (it cannot make the request early)", () => {
    const calm = planStrike({ rttMs: 78, clockErrorMs: 20, prepSamplesMs: [1571, 1522], serverSamplesMs: [186, 190] });
    const busy = planStrike({ rttMs: 78, clockErrorMs: 20, prepSamplesMs: [1571, 1522], serverSamplesMs: [186, 418] });
    expect(busy.arrivalsMs[0]).toBe(calm.arrivalsMs[0]);
    expect(busy.leadMs).toBe(calm.leadMs);
  });

  it("the margin after 00:00 shrinks as the measured token time gets steadier", () => {
    const one = planStrike({ rttMs: 78, clockErrorMs: 20, prepSamplesMs: [1571], serverSamplesMs: [186] });
    const steady = planStrike({
      rttMs: 78,
      clockErrorMs: 20,
      prepSamplesMs: [1560, 1575, 1580, 1565, 1570],
      serverSamplesMs: [180, 186, 190, 184],
    });
    expect(steady.arrivalsMs[0]).toBeLessThan(one.arrivalsMs[0]);
    expect(steady.arrivalsMs[0]).toBeGreaterThan(0);
  });
});
