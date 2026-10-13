// DealHunter main-world helper for Caffiliate check-in.
//
// Strike ("dh-caffiliate-strike" from the content script): attempts start on the schedule the content
// script computed (src/lib/strike_plan.ts: at least 5, timed from the measured Turnstile time,
// latency and clock error so the requests reach the server spread around 00:00). Each attempt walks
// three tiers, moving down only when the tier above fails:
//   1. the page's own function: app.checkIn() (or a check-in/claim/reward-named method if it has none)
//   2. the check-in API, with a fresh token from the page's own getToken and the page's own signature
//   3. a click on the check-in button
// As soon as one attempt is confirmed, the attempts not started yet are cancelled.
//
// Timing: every attempt's tier, Turnstile token time, request and response are reported to the
// content script ("dh-checkin-timing", JSON string), shown in the popup's Log tab.
(function () {
  if (typeof window === "undefined" || window.__dhCheckinTiming) return;
  // Non-enumerable marker so double injection is a no-op without adding a visible global.
  Object.defineProperty(window, "__dhCheckinTiming", { value: true });

  // Used only if the strike event carries no schedule.
  var FALLBACK_OFFSETS_MS = [0, 35, 70, 105, 140];
  var CONFIRM_POLL_MS = 10;
  var CONFIRM_TIMEOUT_MS = 8000;
  var CHECKIN_API = "/api/v2/xeng/check-in-secure";
  var CHECKIN_URL = /check-?in/i;

  var run = null; // { startAt, attempts: [...], ok, method, error, source }

  function now() {
    return performance.timeOrigin + performance.now();
  }

  function emit(name, payload) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(payload) }));
    } catch (e) {}
  }

  function errText(err) {
    return String(err && err.message ? err.message : err).slice(0, 200);
  }

  function getApp() {
    var w = window;
    var inst = w.app || w.caffiliate || w.CaffiliateApp || w.rewardApp || w.xengApp || null;
    if (!inst) {
      try {
        // `app` declared with let/const at the page's top level is a global binding, not a window property
        if (typeof app !== "undefined") inst = app;
      } catch (e) {}
    }
    if (!inst) {
      try {
        for (var k of Object.keys(w)) {
          var v = w[k];
          if (v && typeof v === "object" && v.state && ("todayCheckedIn" in v.state || v.state.csrfToken)) {
            inst = v;
            break;
          }
        }
      } catch (e) {}
    }
    return inst;
  }

  function findCheckInButton() {
    var btn = document.getElementById("btnCheckIn") || document.getElementById("caffiliate-checkin-btn");
    if (!btn) btn = document.querySelector('button[id*="CheckIn" i], button[id*="checkin" i], button[id*="diemdanh" i]');
    if (!btn) {
      btn = Array.from(document.querySelectorAll("button, [role='button']")).find(function (b) {
        return /điểm danh|diem danh|nhận xèng/i.test(b.textContent || "");
      }) || null;
    }
    return btn;
  }

  // Today's check-in is confirmed when the server's answer flips the page state back to checked in,
  // or the button turns into "Đã điểm danh #N" (a label already shown before the strike is yesterday's).
  function isCheckedIn(app, textBefore) {
    if (app && app.state && app.state.todayCheckedIn === true) return true;
    var btn = findCheckInButton();
    var text = btn ? btn.textContent || "" : "";
    return text !== textBefore && /đã điểm danh|da diem danh/i.test(text) && /#\d+/.test(text);
  }

  function finishRun(ok, method, error) {
    if (!run || run.done) return;
    run.done = true;
    (run.timers || []).forEach(clearTimeout); // attempts not started yet are not needed any more
    delete run.timers;
    run.ok = ok;
    run.method = method;
    if (error) run.error = error;
    emit("dh-checkin-timing", run);
    emit("dh-checkin-result", { ok: ok, method: method, error: error || null });
  }

  // ---- Tier 1: the page's own function ------------------------------------------------------------
  function findCheckInFunction(app) {
    if (!app) return null;
    if (typeof app.checkIn === "function") return { fn: app.checkIn, name: "checkIn" };
    for (var k of Object.keys(app)) {
      if (typeof app[k] === "function" && /^(check_?in|claim|diem_?danh|attendance|reward)/i.test(k)) {
        return { fn: app[k], name: k };
      }
    }
    return null;
  }

  // ---- Tier 2: the check-in API -------------------------------------------------------------------
  async function checkInViaApi(app) {
    if (!app || typeof app.generateSignature !== "function") {
      throw new Error("no page signature function");
    }
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    var csrf = (app.state && app.state.csrfToken) || (csrfMeta ? csrfMeta.getAttribute("content") : "") || "";
    var token = "";
    if (window.CheckInTurnstile && typeof window.CheckInTurnstile.getToken === "function") {
      token = await window.CheckInTurnstile.getToken();
    }
    var ts = Date.now().toString();
    var nonce = Math.random().toString(36).substring(2, 15);
    var signature = await app.generateSignature(ts, nonce);
    var headers = { "Content-Type": "application/json", "x-timestamp": ts, "x-nonce": nonce, "x-signature": signature };
    if (csrf) headers["x-csrf-token"] = csrf;
    var resp = await window.fetch(CHECKIN_API, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ "cf-turnstile-response": token || "" }),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var body = null;
    try { body = await resp.clone().json(); } catch (e) {}
    if (body && (body.success === false || body.ok === false || body.error)) {
      throw new Error(body.message || body.error || "rejected by server");
    }
  }

  // ---- Tier 3: click the button -------------------------------------------------------------------
  function clickCheckInButton() {
    var btn = findCheckInButton();
    if (!btn) throw new Error("check-in button not found");
    if ("disabled" in btn) btn.disabled = false;
    btn.removeAttribute("disabled");
    btn.setAttribute("aria-disabled", "false");
    btn.classList.remove("disabled", "pointer-events-none");
    btn.style.pointerEvents = "auto";
    btn.click();
  }

  function runAttempt(r, app, n) {
    var a = { n: n, startAt: now(), tiers: [] };
    r.attempts.push(a);

    if (app && app.state) {
      // In-flight locks from an earlier attempt would make checkIn() return early.
      ["checkInLocked", "isCheckingIn"].forEach(function (k) {
        if (k in app.state) app.state[k] = false;
      });
    }

    function tier3(reason) {
      a.tiers.push({ tier: 2, ok: false, error: reason });
      try {
        clickCheckInButton();
        a.tiers.push({ tier: 3, ok: true, name: "button click" });
      } catch (err) {
        a.tiers.push({ tier: 3, ok: false, error: errText(err) });
      }
    }

    function tier2(reason) {
      a.tiers.push({ tier: 1, ok: false, error: reason });
      checkInViaApi(app).then(
        function () {
          a.tiers.push({ tier: 2, ok: true, name: "API" });
          if (app && app.state) app.state.todayCheckedIn = true;
          finishRun(true, "API (attempt " + n + ")", null);
        },
        function (err) { tier3(errText(err)); }
      );
    }

    var f = findCheckInFunction(app);
    if (!f) return tier2(app ? "no check-in function" : "app not found");
    try {
      var ret = f.fn.call(app);
      a.tiers.push({ tier: 1, ok: true, name: f.name + "()" });
      if (ret && typeof ret.then === "function") {
        ret.then(null, function (err) {
          a.tiers.pop();
          tier2(errText(err));
        });
      }
    } catch (err) {
      tier2(errText(err));
    }
  }

  function readSchedule(ev) {
    try {
      var d = ev && typeof ev.detail === "string" ? JSON.parse(ev.detail) : null;
      var offsets = d && Array.isArray(d.offsetsMs) ? d.offsetsMs.filter(function (v) { return typeof v === "number" && v >= 0 && v < 5000; }) : [];
      if (offsets.length > 0) return { offsets: offsets.sort(function (a, b) { return a - b; }), plan: d.plan || null };
    } catch (e) {}
    return { offsets: FALLBACK_OFFSETS_MS, plan: null };
  }

  function handleStrike(ev) {
    if (run && !run.done) return; // one strike sequence at a time
    wrapTurnstile(); // in case the timing wrapper has not caught up with a late-loaded Turnstile helper
    var schedule = readSchedule(ev);
    var app = getApp();
    var r = (run = { startAt: now(), attempts: [], source: "strike", plan: schedule.plan, timers: [] });
    var btn = findCheckInButton();
    var textBefore = btn ? btn.textContent || "" : "";

    if (app && app.state) {
      // Flags left over from yesterday's page state would make checkIn() return early; the server
      // decides whether today's check-in is allowed.
      ["todayCheckedIn", "isCheckedIn", "hasClaimed"].forEach(function (k) {
        if (k in app.state) app.state[k] = false;
      });
    }

    // Each attempt is timed from the strike start, so a late timer does not push the next ones.
    var n = 0;
    schedule.offsets.forEach(function (offset, i) {
      if (r.done) return;
      var start = function () {
        if (r.done) return;
        if (isCheckedIn(app, textBefore)) return finishRun(true, "page confirmed", null);
        runAttempt(r, app, ++n);
      };
      if (i === 0) start();
      else r.timers.push(setTimeout(start, Math.max(0, r.startAt + offset - now())));
    });

    (function poll() {
      if (r.done) return;
      if (isCheckedIn(app, textBefore)) return finishRun(true, "page confirmed", null);
      if (now() - r.startAt > CONFIRM_TIMEOUT_MS) return finishRun(false, null, "not confirmed by the page");
      setTimeout(poll, CONFIRM_POLL_MS);
    })();
  }

  window.addEventListener("dh-caffiliate-strike", handleStrike);

  // A manual click on the check-in button is measured too.
  document.addEventListener(
    "click",
    function (ev) {
      if (!ev.isTrusted || (run && !run.done)) return;
      var btn = ev.target && ev.target.closest ? ev.target.closest("button, [role='button']") : null;
      if (!btn) return;
      if (!/check-?in|diemdanh/i.test(btn.id || "") && !/điểm danh|diem danh|nhận xèng/i.test(btn.textContent || "")) return;
      var app = getApp();
      var textBefore = btn.textContent || "";
      var r = (run = { startAt: now(), attempts: [{ n: 1, startAt: now(), tiers: [{ tier: 3, ok: true, name: "manual click" }] }], source: "manual" });
      (function poll() {
        if (r.done) return;
        if (isCheckedIn(app, textBefore)) return finishRun(true, "manual click", null);
        if (now() - r.startAt > CONFIRM_TIMEOUT_MS) return finishRun(false, null, "not confirmed by the page");
        setTimeout(poll, 50);
      })();
    },
    true
  );

  // ---- Timing: attribute token fetches and check-in requests to attempts, in order --------------
  function nextAttempt(field) {
    if (!run || run.done) return null;
    for (var i = 0; i < run.attempts.length; i++) {
      if (run.attempts[i][field] === undefined) return run.attempts[i];
    }
    return null;
  }

  function wrapTurnstile() {
    var ts = window.CheckInTurnstile;
    if (!ts || typeof ts.getToken !== "function" || ts.getToken.__dhTimed) return Boolean(ts);
    var orig = ts.getToken;
    var timed = function () {
      var a = nextAttempt("tokenStartAt");
      if (a) a.tokenStartAt = now();
      var result = orig.apply(this, arguments);
      if (a && result && typeof result.then === "function") {
        result.then(
          function () { a.tokenEndAt = now(); },
          function () { a.tokenEndAt = now(); a.tokenError = true; }
        );
      }
      return result;
    };
    Object.defineProperty(timed, "__dhTimed", { value: true });
    ts.getToken = timed;
    return true;
  }
  var wrapTries = 0;
  var wrapTimer = setInterval(function () {
    if (wrapTurnstile() || ++wrapTries > 120) clearInterval(wrapTimer);
  }, 500);

  function onRequestStart(url) {
    if (!CHECKIN_URL.test(String(url))) return null;
    var a = nextAttempt("requestStartAt");
    if (a) a.requestStartAt = now();
    return a;
  }
  function onResponse(a, status, serverDate) {
    if (!a) return;
    a.responseAt = now();
    a.status = status;
    if (serverDate) a.serverDate = serverDate;
  }

  if (typeof window.fetch === "function") {
    var origFetch = window.fetch;
    window.fetch = function (input) {
      var url = typeof input === "string" ? input : input && input.url;
      var a = onRequestStart(url);
      var p = origFetch.apply(this, arguments);
      if (a) {
        p.then(
          function (resp) { onResponse(a, resp.status, resp.headers.get("date")); },
          function () { onResponse(a, 0, null); }
        );
      }
      return p;
    };
  }

  if (typeof XMLHttpRequest !== "undefined") {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__dhUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var a = onRequestStart(this.__dhUrl);
      if (a) {
        var xhr = this;
        xhr.addEventListener("loadend", function () {
          onResponse(a, xhr.status, xhr.getResponseHeader("date"));
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  // Interactive Turnstile challenge visible: tell the HUD so the user can tick it by hand.
  setInterval(function () {
    var active = Boolean(document.querySelector('iframe[src*="challenges.cloudflare.com"]'));
    if (active) document.documentElement.setAttribute("data-dh-turnstile-challenge", "active");
    else document.documentElement.removeAttribute("data-dh-turnstile-challenge");
  }, 500);
})();
