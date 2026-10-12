// DealHunter Main-World Bridge for Caffiliate Platform
// Pure Vanilla JavaScript (executed directly by the browser in Main World).
(function() {
  if (typeof window === "undefined" || window.__dh_caffiliate_bridge_installed) return;
  window.__dh_caffiliate_bridge_installed = true;

  var prewarmedTurnstileToken = "";
  var prewarmedAt = 0;
  var isPrewarmingTurnstile = false;
  var lastStrikeAt = 0;
  var strikeAttempts = 0;

  function markCheckedIn() {
    try {
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.setAttribute("data-dh-checked-in", "true");
      }
    } catch (e) {}
  }

  function getCookie(name) {
    try {
      var match = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
      return match ? decodeURIComponent(match[2]) : "";
    } catch (e) {
      return "";
    }
  }

  function recordTelemetry(tier, method, success, error, latencyMs) {
    try {
      var tel = {
        tier: tier,
        method: method,
        success: success,
        latencyMs: typeof latencyMs === "number" ? latencyMs : 0,
        turnstilePrewarmed: Boolean(prewarmedTurnstileToken || window._dh_turnstile_prewarmed),
        timestamp: new Date().toISOString(),
        error: error ? String(error) : null
      };

      if (typeof window !== "undefined") {
        window.__dh_telemetry = tel;
        if (!window.__dh_telemetry_history) {
          window.__dh_telemetry_history = [];
        }
        window.__dh_telemetry_history.push(tel);
      }

      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.setAttribute("data-dh-strike-tier", String(tier));
        document.documentElement.setAttribute("data-dh-strike-method", method);
        document.documentElement.setAttribute("data-dh-strike-latency", String(tel.latencyMs));
      }

      var styleHeader = "background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 3px;";
      var styleTier = success
        ? "background: #065f46; color: #34d399; font-weight: bold; padding: 2px 6px; border-radius: 3px;"
        : "background: #7f1d1d; color: #f87171; font-weight: bold; padding: 2px 6px; border-radius: 3px;";

      var statusText = success ? "SUCCESS" : "FAILED";
      console.info(
        "%c[DealHunter]%c[Tier " + tier + "] " + method + " -> " + statusText + " (" + tel.latencyMs + "ms)",
        styleHeader,
        styleTier,
        tel
      );
    } catch (e) {}
  }

  // Quick helper for DevTools console inspection
  if (typeof window !== "undefined") {
    window.dhTelemetry = function() {
      return window.__dh_telemetry;
    };
    window.dhHistory = function() {
      return window.__dh_telemetry_history || [];
    };
  }

  function getAppInstance() {
    var appInst = null;
    var win = window;
    if (typeof win.app !== "undefined") appInst = win.app;
    else if (typeof win.caffiliate !== "undefined") appInst = win.caffiliate;
    else if (typeof win.CaffiliateApp !== "undefined") appInst = win.CaffiliateApp;
    else if (typeof win.rewardApp !== "undefined") appInst = win.rewardApp;
    else if (typeof win.xengApp !== "undefined") appInst = win.xengApp;
    else {
      try {
        if (typeof app !== "undefined") appInst = app;
      } catch (e) {}
    }

    if (!appInst) {
      try {
        for (var k of Object.keys(win)) {
          try {
            var val = win[k];
            if (
              val &&
              typeof val === "object" &&
              val.state &&
              ("todayCheckedIn" in val.state || val.state.csrfToken || val.state.googleId)
            ) {
              appInst = val;
              break;
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    return appInst;
  }

  // Continuously detect check-in confirmation and Turnstile challenges to notify extension HUD
  function checkCompletionState() {
    try {
      // 1. Detect Turnstile Interactive Challenge active (needs user click)
      var challengeFrame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      if (challengeFrame) {
        document.documentElement.setAttribute("data-dh-turnstile-challenge", "active");
      } else {
        document.documentElement.removeAttribute("data-dh-turnstile-challenge");
      }

      // 2. Detection of completed check-in
      var appInst = getAppInstance();
      if (appInst && appInst.state && appInst.state.todayCheckedIn === true) {
        markCheckedIn();
        return;
      }
      var btn = document.getElementById("btnCheckIn") || document.getElementById("caffiliate-checkin-btn");
      if (btn) {
        var text = btn.textContent || "";
        if ((text.includes("Đã điểm danh") || text.includes("da diem danh")) && /#\d+/.test(text)) {
          markCheckedIn();
          return;
        }
      }
      if (document.querySelector(".swal2-container") || document.querySelector(".swal2-popup")) {
        markCheckedIn();
        return;
      }
    } catch (e) {}
  }

  var completionTimer = setInterval(function() {
    checkCompletionState();
    if (
      typeof document !== "undefined" &&
      document.documentElement &&
      document.documentElement.getAttribute("data-dh-checked-in") === "true"
    ) {
      clearInterval(completionTimer);
      // Reduce polling frequency after confirmation to save system resources
      setInterval(checkCompletionState, 5000);
    }
  }, 150);

  function prewarmTurnstile() {
    if (isPrewarmingTurnstile) return;
    isPrewarmingTurnstile = true;

    try {
      if (
        typeof window !== "undefined" &&
        window.CheckInTurnstile &&
        typeof window.CheckInTurnstile.getToken === "function"
      ) {
        var origGetToken = window.CheckInTurnstile.getToken;

        // Wrap getToken so the first call resolves instantly with cached token,
        // and any subsequent fallback calls obtain a fresh token from Cloudflare.
        if (!origGetToken.__dh_wrapped) {
          window.CheckInTurnstile.getToken = function() {
            if (prewarmedTurnstileToken && (Date.now() - prewarmedAt < 240000)) {
              var cached = prewarmedTurnstileToken;
              prewarmedTurnstileToken = "";
              window._dh_turnstile_prewarmed = "";
              return Promise.resolve(cached);
            }
            return origGetToken.apply(this, arguments);
          };
          window.CheckInTurnstile.getToken.__dh_wrapped = true;
          window.CheckInTurnstile.getToken.__dh_orig = origGetToken;
        }

        var fetchStart = Date.now();
        var fetcher = window.CheckInTurnstile.getToken.__dh_orig || origGetToken;
        fetcher.call(window.CheckInTurnstile).then(function(token) {
          if (token && typeof token === "string") {
            prewarmedTurnstileToken = token;
            prewarmedAt = Date.now();
            window._dh_turnstile_prewarmed = token;
            var lat = Date.now() - fetchStart;
            console.info(
              "%c[DealHunter]%c[Pre-Warm] Cloudflare Turnstile token cached successfully (" + lat + "ms)",
              "background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
              "background: #065f46; color: #34d399; font-weight: bold; padding: 2px 6px; border-radius: 3px;"
            );
          }
        }).catch(function(err) {
          console.warn(
            "%c[DealHunter]%c[Pre-Warm] Cloudflare Turnstile pre-fetch warning: " + err,
            "background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
            "background: #78350f; color: #fbbf24; font-weight: bold; padding: 2px 6px; border-radius: 3px;"
          );
        }).finally(function() {
          isPrewarmingTurnstile = false;
        });
      } else {
        isPrewarmingTurnstile = false;
        // Retry polling if CheckInTurnstile script is still loading lazily
        var retries = 0;
        var retryTimer = setInterval(function() {
          retries++;
          if (window.CheckInTurnstile || retries > 6) {
            clearInterval(retryTimer);
            if (window.CheckInTurnstile && !prewarmedTurnstileToken) {
              prewarmTurnstile();
            }
          }
        }, 300);
      }
    } catch (e) {
      isPrewarmingTurnstile = false;
    }
  }

  function handlePrewarm() {
    try {
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.removeAttribute("data-dh-checked-in");
        document.documentElement.removeAttribute("data-dh-turnstile-challenge");
        document.documentElement.removeAttribute("data-dh-strike-tier");
        document.documentElement.removeAttribute("data-dh-strike-method");
        document.documentElement.removeAttribute("data-dh-strike-latency");
      }

      console.info(
        "%c[DealHunter]%c[Pre-Warm] Pre-warming sequence started (Socket keep-alive + Turnstile pre-fetch)",
        "background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
        "background: #1e293b; color: #94a3b8; padding: 2px 6px;"
      );

      // 1. Pre-warm TCP + TLS socket connection to reduce API latency by 100-200ms
      if (typeof fetch === "function") {
        fetch("/api/v2/xeng/check-in-secure", { method: "OPTIONS", keepalive: true }).catch(function() {});
      }

      // 2. Pre-fetch Cloudflare Turnstile token ahead of 00:00:00 (TTL is 300s, eliminates 200ms latency)
      prewarmTurnstile();

      // 3. Preload Cloudflare Turnstile script if not already present
      if (typeof window !== "undefined" && !window.turnstile && typeof document !== "undefined") {
        var existingLink = document.querySelector('link[href*="challenges.cloudflare.com/turnstile"]');
        if (!existingLink) {
          var preload = document.createElement("link");
          preload.rel = "preload";
          preload.as = "script";
          preload.href = "https://challenges.cloudflare.com/turnstile/v0/api.js";
          (document.head || document.documentElement).appendChild(preload);
        }
      }
    } catch (e) {}
  }

  async function executeDirectApi(appInst) {
    try {
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      var csrfToken =
        (appInst && appInst.state && appInst.state.csrfToken) ||
        (csrfMeta ? csrfMeta.getAttribute("content") : "") ||
        (window.Laravel && window.Laravel.csrfToken) ||
        window.csrfToken ||
        getCookie("XSRF-TOKEN") ||
        "";

      var turnstileToken =
        prewarmedTurnstileToken ||
        window._dh_turnstile_prewarmed ||
        "";

      if (!turnstileToken && window.CheckInTurnstile && typeof window.CheckInTurnstile.getToken === "function") {
        var fetcher = window.CheckInTurnstile.getToken.__dh_orig || window.CheckInTurnstile.getToken;
        turnstileToken = await fetcher.call(window.CheckInTurnstile);
      }

      if (!turnstileToken) {
        var hiddenInput = document.querySelector('input[name="cf-turnstile-response"]');
        if (hiddenInput && hiddenInput.value) {
          turnstileToken = hiddenInput.value;
        } else if (window.turnstile && typeof window.turnstile.getResponse === "function") {
          turnstileToken = window.turnstile.getResponse();
        }
      }

      var ts = Date.now().toString();
      var nonce = Math.random().toString(36).substring(2, 15);
      var signature = "";

      if (appInst && typeof appInst.generateSignature === "function") {
        signature = await appInst.generateSignature(ts, nonce);
      }

      var headers = {
        "Content-Type": "application/json",
      };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      if (signature) headers["x-signature"] = signature;
      headers["x-timestamp"] = ts;
      headers["x-nonce"] = nonce;

      var resp = await fetch("/api/v2/xeng/check-in-secure", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          "cf-turnstile-response": turnstileToken || "",
        }),
      });

      if (resp.ok) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function executeDomButtonClick() {
    try {
      var btn = document.getElementById("btnCheckIn") || document.getElementById("caffiliate-checkin-btn");
      if (!btn) {
        btn = document.querySelector('button[id*="CheckIn" i], button[id*="checkin" i], button[id*="diemdanh" i]');
      }
      if (!btn) {
        var allButtons = Array.from(document.querySelectorAll("button, [role='button']"));
        btn = allButtons.find(function(b) {
          return /điểm danh|diem danh|nhận xèng/i.test(b.textContent || "");
        }) || null;
      }

      if (btn) {
        if ("disabled" in btn) btn.disabled = false;
        btn.removeAttribute("disabled");
        btn.setAttribute("aria-disabled", "false");
        btn.classList.remove("disabled", "pointer-events-none");
        btn.style.pointerEvents = "auto";
        btn.click();
        return true;
      }
    } catch (e) {}
    return false;
  }

  function fallbackToApiThenDom(appInst, strikeStartTime) {
    console.warn(
      "%c[DealHunter]%c[Fallback] Triggering Tier 2 (Direct API: /api/v2/xeng/check-in-secure)...",
      "background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
      "background: #78350f; color: #fbbf24; font-weight: bold; padding: 2px 6px; border-radius: 3px;"
    );

    var apiStartTime = Date.now();
    executeDirectApi(appInst).then(function(ok) {
      var apiLat = Date.now() - apiStartTime;
      if (ok) {
        recordTelemetry(2, "Direct API: /api/v2/xeng/check-in-secure", true, null, apiLat);
        markCheckedIn();
      } else {
        recordTelemetry(2, "Direct API: /api/v2/xeng/check-in-secure", false, "Response status not OK", apiLat);
        console.warn(
          "%c[DealHunter]%c[Fallback] Tier 2 unsuccessful, triggering Tier 3 (DOM Click: #btnCheckIn)...",
          "background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
          "background: #78350f; color: #fbbf24; font-weight: bold; padding: 2px 6px; border-radius: 3px;"
        );
        var domStartTime = Date.now();
        var domOk = executeDomButtonClick();
        var domLat = Date.now() - domStartTime;
        recordTelemetry(3, "DOM Click: #btnCheckIn", domOk, domOk ? null : "Target button not found", domLat);
        if (domOk) markCheckedIn();
      }
    }).catch(function(err) {
      var apiLat = Date.now() - apiStartTime;
      recordTelemetry(2, "Direct API: /api/v2/xeng/check-in-secure", false, err, apiLat);
      console.warn(
        "%c[DealHunter]%c[Fallback] Tier 2 exception, triggering Tier 3 (DOM Click: #btnCheckIn)...",
        "background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
        "background: #78350f; color: #fbbf24; font-weight: bold; padding: 2px 6px; border-radius: 3px;"
      );
      var domStartTime = Date.now();
      var domOk = executeDomButtonClick();
      var domLat = Date.now() - domStartTime;
      recordTelemetry(3, "DOM Click: #btnCheckIn", domOk, domOk ? null : "Target button not found", domLat);
      if (domOk) markCheckedIn();
    });
  }

  function handleStrike() {
    var now = Date.now();
    // Micro-burst rate-limiter: allow up to 3 rapid attempts spaced >= 30ms apart
    if (now - lastStrikeAt < 30) return;
    lastStrikeAt = now;
    strikeAttempts++;
    if (strikeAttempts > 4) return;

    // Stop immediately if already confirmed checked in
    if (
      typeof document !== "undefined" &&
      document.documentElement &&
      document.documentElement.getAttribute("data-dh-checked-in") === "true"
    ) {
      return;
    }

    try {
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.removeAttribute("data-dh-turnstile-challenge");
      }

      var strikeStartTime = Date.now();
      console.info(
        "%c[DealHunter]%c[Strike] Strike initiated at " + new Date().toISOString() + " (Attempt #" + strikeAttempts + ")",
        "background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 3px;",
        "background: #1e293b; color: #f8fafc; font-weight: bold; padding: 2px 6px; border-radius: 3px;"
      );

      var appInst = getAppInstance();
      var inAppTriggered = false;

      // -----------------------------------------------------------------
      // TRƯỜNG HỢP 1 (Ưu tiên 1): Gọi hàm in-app checkIn()
      // Chạy thẳng trong scope Vue/app của trang với Turnstile đã pre-warmed (0ms)
      // -----------------------------------------------------------------
      if (appInst) {
        if (appInst.state) {
          appInst.state.todayCheckedIn = false;
          if ("isCheckedIn" in appInst.state) appInst.state.isCheckedIn = false;
          if ("checkInLocked" in appInst.state) appInst.state.checkInLocked = false;
          if ("hasClaimed" in appInst.state) appInst.state.hasClaimed = false;
          if ("isCheckingIn" in appInst.state) appInst.state.isCheckingIn = false;
        }

        if (typeof appInst.checkIn === "function") {
          try {
            var ret = appInst.checkIn();
            inAppTriggered = true;
            if (ret && typeof ret.then === "function") {
              ret.then(function() {
                var lat = Date.now() - strikeStartTime;
                recordTelemetry(1, "In-App: app.checkIn()", true, null, lat);
                markCheckedIn();
              }).catch(function(err) {
                var lat = Date.now() - strikeStartTime;
                recordTelemetry(1, "In-App: app.checkIn()", false, err, lat);
                fallbackToApiThenDom(appInst, strikeStartTime);
              });
            } else {
              var lat = Date.now() - strikeStartTime;
              recordTelemetry(1, "In-App: app.checkIn()", true, null, lat);
              markCheckedIn();
            }
          } catch (e) {
            inAppTriggered = false;
            var lat = Date.now() - strikeStartTime;
            recordTelemetry(1, "In-App: app.checkIn()", false, e, lat);
          }
        }

        if (!inAppTriggered) {
          for (var m of Object.keys(appInst)) {
            if (typeof appInst[m] === "function" && /^(check_?in|claim|diem_?danh|attendance|reward)/i.test(m)) {
              try {
                var retB = appInst[m].call(appInst);
                inAppTriggered = true;
                if (retB && typeof retB.then === "function") {
                  retB.then(function() {
                    var lat = Date.now() - strikeStartTime;
                    recordTelemetry(1, "In-App: app." + m + "()", true, null, lat);
                    markCheckedIn();
                  }).catch(function(err) {
                    var lat = Date.now() - strikeStartTime;
                    recordTelemetry(1, "In-App: app." + m + "()", false, err, lat);
                    fallbackToApiThenDom(appInst, strikeStartTime);
                  });
                } else {
                  var lat = Date.now() - strikeStartTime;
                  recordTelemetry(1, "In-App: app." + m + "()", true, null, lat);
                  markCheckedIn();
                }
                break;
              } catch (e) {
                inAppTriggered = false;
                var lat = Date.now() - strikeStartTime;
                recordTelemetry(1, "In-App: app." + m + "()", false, e, lat);
              }
            }
          }
        }
      }

      // -----------------------------------------------------------------
      // Nếu Trường hợp 1 không chạy được (không có app / lỗi đồng bộ),
      // lập tức kích hoạt chuỗi fallback: Trường hợp 2 (API) -> Trường hợp 3 (DOM)
      // -----------------------------------------------------------------
      if (!inAppTriggered) {
        if (!appInst) {
          recordTelemetry(1, "In-App: app.checkIn()", false, "App instance not found", 0);
        }
        fallbackToApiThenDom(appInst, strikeStartTime);
      }

      // Autonomous micro-burst retry: if not confirmed checked-in within 35ms,
      // retry up to 3 total attempts to absorb any minor server gate delay
      if (strikeAttempts < 3) {
        setTimeout(function() {
          if (
            typeof document !== "undefined" &&
            document.documentElement &&
            document.documentElement.getAttribute("data-dh-checked-in") !== "true"
          ) {
            handleStrike();
          }
        }, 35);
      }
    } catch (err) {
      recordTelemetry(1, "In-App: app.checkIn()", false, err, 0);
      fallbackToApiThenDom(null, Date.now());
    }
  }

  window.addEventListener("dh-caffiliate-prewarm", handlePrewarm);
  window.addEventListener("dh-caffiliate-strike", handleStrike);
})();
