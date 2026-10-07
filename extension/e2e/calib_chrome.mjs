import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.goto("https://shopee.vn/favicon.ico");
for (let run = 0; run < 3; run++) {
  const out = await page.evaluate(async () => {
    const probes = []; let seen = 0; const deadline = Date.now() + 6000;
    while (Date.now() < deadline && seen < 3) {
      const sentAt = Date.now();
      const res = await fetch("/favicon.ico", { method: "HEAD", cache: "no-store", credentials: "omit" });
      const receivedAt = Date.now();
      const s = new Date(res.headers.get("date")).getTime();
      const last = probes[probes.length - 1];
      if (last && s === last.serverSecondMs + 1000) seen++;
      probes.push({ sentAt, receivedAt, serverSecondMs: s });
    }
    const est = [];
    for (let i = 1; i < probes.length; i++) {
      const a = probes[i - 1], b = probes[i];
      if (b.serverSecondMs !== a.serverSecondMs + 1000) continue;
      const am = (a.sentAt + a.receivedAt) / 2, bm = (b.sentAt + b.receivedAt) / 2;
      est.push({ off: b.serverSecondMs - (am + bm) / 2, err: (bm - am) / 2 });
    }
    est.sort((x, y) => x.off - y.off);
    const rtts = probes.map(p => p.receivedAt - p.sentAt).sort((a, b) => a - b);
    return `probes=${probes.length} medianRTT=${rtts[Math.floor(rtts.length / 2)]}ms median offset=${Math.round(est[Math.floor(est.length / 2)].off)}ms (all: ${est.map(e => Math.round(e.off) + "±" + Math.round(e.err)).join(", ")})`;
  });
  console.log(out);
}
await browser.close();
