// DealHunter main-world helper for Caffiliate check-in.
// Observe only: it never calls the page's functions, never alters its state or its Turnstile flow.
// It measures where the time goes after the check-in click (click -> Turnstile token -> check-in
// request -> response) and reports it to the content script as a JSON string event.
(function () {
  if (typeof window === "undefined" || window.__dhCheckinTiming) return;
  // Non-enumerable marker so double injection is a no-op without adding a visible global.
  Object.defineProperty(window, "__dhCheckinTiming", { value: true });

  var CHECKIN_URL = /check-?in/i;
  var run = null; // timings of the current check-in attempt (epoch ms, Date.now())

  function now() {
    return performance.timeOrigin + performance.now();
  }

  function report() {
    if (!run || run.reported) return;
    run.reported = true;
    try {
      window.dispatchEvent(new CustomEvent("dh-checkin-timing", { detail: JSON.stringify(run) }));
    } catch (e) {}
  }

  function isCheckInButton(el) {
    var btn = el && el.closest ? el.closest("button, [role='button']") : null;
    if (!btn) return false;
    if (/check-?in|diemdanh/i.test(btn.id || "")) return true;
    return /điểm danh|diem danh|nhận xèng|nhan xeng/i.test(btn.textContent || "");
  }

  // 1. Click on the check-in button starts a new measurement.
  document.addEventListener(
    "click",
    function (ev) {
      if (!isCheckInButton(ev.target)) return;
      if (run && !run.reported && now() - run.clickAt < 10000) return; // keep the first click of a burst
      run = { clickAt: now(), trusted: ev.isTrusted };
    },
    true
  );

  // 2. Turnstile token: time the page's own getToken call, passing it through unchanged.
  function wrapTurnstile() {
    var ts = window.CheckInTurnstile;
    if (!ts || typeof ts.getToken !== "function" || ts.getToken.__dhTimed) return Boolean(ts);
    var orig = ts.getToken;
    var timed = function () {
      var r = run;
      if (r && !r.tokenStartAt) r.tokenStartAt = now();
      var result = orig.apply(this, arguments);
      if (r && result && typeof result.then === "function") {
        result.then(
          function () { if (!r.tokenEndAt) r.tokenEndAt = now(); },
          function () { if (!r.tokenEndAt) { r.tokenEndAt = now(); r.tokenError = true; } }
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

  // 3. Check-in request: time fetch/XHR to the check-in endpoint, passing them through unchanged.
  function onRequestStart(url) {
    if (!run || run.requestStartAt || !CHECKIN_URL.test(String(url))) return null;
    run.requestStartAt = now();
    return run;
  }
  function onResponse(r, status, serverDate) {
    if (!r || r.responseAt) return;
    r.responseAt = now();
    r.status = status;
    if (serverDate) r.serverDate = serverDate;
    report();
  }

  if (typeof window.fetch === "function") {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      var r = onRequestStart(url);
      var p = origFetch.apply(this, arguments);
      if (r) {
        p.then(
          function (resp) { onResponse(r, resp.status, resp.headers.get("date")); },
          function () { onResponse(r, 0, null); }
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
      var r = onRequestStart(this.__dhUrl);
      if (r) {
        var xhr = this;
        xhr.addEventListener("loadend", function () {
          onResponse(r, xhr.status, xhr.getResponseHeader("date"));
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  // 4. Interactive Turnstile challenge visible: tell the HUD so the user can tick it by hand.
  setInterval(function () {
    var active = Boolean(document.querySelector('iframe[src*="challenges.cloudflare.com"]'));
    if (active) document.documentElement.setAttribute("data-dh-turnstile-challenge", "active");
    else document.documentElement.removeAttribute("data-dh-turnstile-challenge");
  }, 500);
})();
