// Loads the built extension in real Chrome and runs a semi-auto hunt on a simulated Shopee voucher page.
import puppeteer from "puppeteer-core";
const EXT = "/Users/tien.dang/Workplace/reference/dealhunter/extension/dist";
const PAGE = "https://shopee.vn/m/dh-e2e-voucher";

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Ma giam gia</title></head><body>
<div id="list">
  <div class="voucher-card" id="decoy"><span>Giam 10k Don toi thieu 99k</span><button id="b-decoy">Lưu</button></div>
  <div class="voucher-card" id="target"><span>Giam 50k Don toi thieu 500k</span><span class="cd">Bat dau sau 00:00:59</span><button id="b-target" disabled>Lưu</button></div>
</div>
<script>
  window.__log = [];
  document.getElementById("b-decoy").addEventListener("click", () => window.__log.push("decoy"));
  // At the next minute (local clock) Shopee's React re-renders the card: brand new, enabled button node
  const release = Math.floor(Date.now() / 60000) * 60000 + 60000;
  window.__release = release;
  const tick = setInterval(() => {
    const left = release - Date.now();
    document.querySelector("#target .cd").textContent = "Bat dau sau 00:00:" + String(Math.max(0, Math.ceil(left / 1000))).padStart(2, "0");
    if (left <= 0) {
      clearInterval(tick);
      const card = document.getElementById("target");
      card.innerHTML = '<span>Giam 50k Don toi thieu 500k</span><span class="cd">Dang dien ra</span><button id="b-target-live">Lưu</button>';
      let n = 0;
      document.getElementById("b-target-live").addEventListener("click", (e) => {
        window.__log.push("target@" + (Date.now() - release) + "ms");
        if (++n === 2) e.currentTarget.textContent = "Đã lưu";
      });
    }
  }, 20);
</script></body></html>`;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  pipe: true,
  enableExtensions: [EXT],
});
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on("request", (req) => (req.url() === PAGE ? req.respond({ status: 200, contentType: "text/html", body: FIXTURE }) : req.continue()));
const logs = [];
page.on("console", (m) => logs.push(m.text()));

await page.goto(PAGE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#dealhunter-hud-root", { timeout: 15000 });
const clickByText = (text) =>
  page.evaluate((t) => { const el = [...document.querySelectorAll("#dealhunter-hud-root button")].find((b) => b.textContent.includes(t)); el?.click(); return !!el; }, text);

await new Promise((r) => setTimeout(r, 4000)); // let the clock calibrate against live Shopee
const hudBefore = await page.$eval("#dealhunter-hud-root", (e) => e.innerText);

await clickByText("Phut Toi");
const hudStatus = () => page.$eval("#dealhunter-hud-root", (e) => e.innerText.split("\n").pop());
console.log("after Phut Toi:", await hudStatus());
await clickByText("Tro Chon Nut");
console.log("after Tro Chon:", await hudStatus());
await page.click("#b-target"); // lock the (still disabled) target voucher
await new Promise((r) => setTimeout(r, 300));
console.log("after picking target:", await hudStatus(), "| highlighted:", await page.$$eval(".dh-target-highlight", (els) => els.map((e) => e.id || e.tagName)));
console.log("arm click found:", await clickByText("BAT SAN MA"));
await new Promise((r) => setTimeout(r, 500));
console.log("HUD after arm:", (await page.$eval("#dealhunter-hud-root", (e) => e.innerText)).replace(/\n/g, " | "));
const releaseAt = await page.evaluate(() => window.__release);
const waitMs = releaseAt - Date.now() + 5000;
console.log(`armed; waiting ${Math.round(waitMs / 1000)}s for the drop...`);
await new Promise((r) => setTimeout(r, Math.max(waitMs, 0)));

const hudAfter = await page.$eval("#dealhunter-hud-root", (e) => e.innerText);
const log = await page.evaluate(() => window.__log);
await browser.close();

const checks = [
  ["HUD injected on shopee.vn page", hudBefore.length > 0],
  ["clock calibrated against live Shopee", /ms ±\d+ms/.test(hudBefore), hudBefore.match(/[+-]?\d+ms ±\d+ms|CHUA DONG BO[^\n]*/)?.[0]],
  ["decoy voucher never clicked", !log.includes("decoy"), JSON.stringify(log)],
  ["new (re-rendered) target button clicked", log.some((l) => l.startsWith("target@")), JSON.stringify(log)],
  ["first click lands within 300ms of the drop", log.filter((l) => l.startsWith("target@")).map((l) => parseInt(l.slice(7))).every((ms) => ms >= 0 && ms < 300), JSON.stringify(log)],
  ["HUD reports saved (page confirmed)", hudAfter.includes("DA LUU MA"), hudAfter.split("\n").slice(-3).join(" | ")],
];
console.log("console:", logs.filter((l) => !l.includes("Download the React")).slice(-15).join("\n  "));
for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
