// Full-auto path in real Chrome: service worker -> content script hunt -> honest status stored by the worker.
import puppeteer from "puppeteer-core";
const EXT = "/Users/tien.dang/Workplace/reference/dealhunter/extension/dist";
const BASE = "https://shopee.vn/m/dh-e2e-full";

const release = Math.ceil((Date.now() + 20000) / 60000) * 60000; // a minute boundary at least 20s away
const fixture = (rel) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="voucher-card"><span>Giam 10k Don toi thieu 99k</span><button id="decoy">Lưu</button></div>
<div class="voucher-card"><span>Giam 500k Don toi thieu 2tr</span><span class="cd">--</span><button id="t" disabled>Lưu</button></div>
<script>
window.__log=[];document.getElementById("decoy").onclick=()=>__log.push("decoy");
const rel=${rel};const iv=setInterval(()=>{const left=rel-Date.now();document.querySelector(".cd").textContent="Bat dau sau 00:00:"+String(Math.max(0,Math.ceil(left/1000))).padStart(2,"0");
if(left<=0){clearInterval(iv);const c=document.querySelectorAll(".voucher-card")[1];c.innerHTML='<span>Giam 500k Don toi thieu 2tr</span><span>Dang dien ra</span><button id="t2">Lưu</button>';
let n=0;document.getElementById("t2").addEventListener("click",e=>{__log.push("target@"+(Date.now()-rel)+"ms");if(++n===3)e.currentTarget.textContent="Dùng ngay";});}},20);
</script></body></html>`;

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, pipe: true, enableExtensions: [EXT] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on("request", (r) => (r.url().startsWith(BASE) ? r.respond({ status: 200, contentType: "text/html", body: fixture(release) }) : r.continue()));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2000));

const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("background.js"));
const sw = await swTarget.worker();

// Vietnam wall clock of the release minute
const vn = new Date(release + 7 * 3600 * 1000);
const task = { id: "e2e", targetHour: vn.getUTCHours(), targetMinute: vn.getUTCMinutes(), targetUrl: BASE, label: "e2e", mode: "full_auto", keyword: "500k", status: "running", createdAt: Date.now() };

await sw.evaluate(async (task, base) => {
  await chrome.storage.local.set({ dh_scheduled_tasks: [task] });
  const [tab] = await chrome.tabs.query({ url: base });
  await chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_FULL_AUTO", task });
}, task, BASE);
console.log(`full-auto armed for ${String(task.targetHour).padStart(2, "0")}:${String(task.targetMinute).padStart(2, "0")} VN; waiting ${Math.round((release - Date.now()) / 1000)}s...`);
await new Promise((r) => setTimeout(r, release - Date.now() + 5000));

const log = await page.evaluate(() => window.__log);
const stored = await sw.evaluate(async () => (await chrome.storage.local.get("dh_scheduled_tasks")).dh_scheduled_tasks[0]);

// Alarm path: an alarm must open the target Shopee tab and mark the task running
await sw.evaluate(async () => {
  const t = { id: "alarm", targetHour: 0, targetMinute: 0, targetUrl: "https://shopee.vn/m/ma-giam-gia", label: "alarm", mode: "full_auto", status: "pending", createdAt: Date.now() };
  const tasks = (await chrome.storage.local.get("dh_scheduled_tasks")).dh_scheduled_tasks || [];
  await chrome.storage.local.set({ dh_scheduled_tasks: [...tasks, t] });
  chrome.alarms.create("dh_task_alarm", { when: Date.now() + 300 });
});
await new Promise((r) => setTimeout(r, 12000));
const alarmTabs = await sw.evaluate(async () => (await chrome.tabs.query({ url: "https://shopee.vn/m/ma-giam-gia*" })).length);
const alarmTask = await sw.evaluate(async () => (await chrome.storage.local.get("dh_scheduled_tasks")).dh_scheduled_tasks.find((t) => t.id === "alarm"));
await browser.close();

const checks = [
  ["keyword voucher (500k) clicked after it opened", log.some((l) => l.startsWith("target@")), JSON.stringify(log)],
  ["decoy (99k, already open) never clicked", !log.includes("decoy"), JSON.stringify(log)],
  ["task stored as completed with page-confirmed result", stored?.status === "completed" && stored?.lastResult?.result === "saved", JSON.stringify(stored?.lastResult)],
  ["alarm opened the target Shopee tab", alarmTabs === 1, `tabs=${alarmTabs}`],
  ["alarm marked the task running", alarmTask?.status === "running", alarmTask?.status],
];
for (const [n, ok, d] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`);
