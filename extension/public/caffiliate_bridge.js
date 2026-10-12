// DealHunter Main-World Bridge for Caffiliate Platform
// Pure Vanilla JavaScript (executed directly by the browser in Main World).
(function() {
  if (typeof window === "undefined" || window.__dh_caffiliate_bridge_installed) return;
  window.__dh_caffiliate_bridge_installed = true;

  var strikeInProgress = false;

  function markCheckedIn() {
    try {
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.setAttribute("data-dh-checked-in", "true");
      }
    } catch (e) {}
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

  setInterval(checkCompletionState, 150);

  function handlePrewarm() {
    try {
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.removeAttribute("data-dh-checked-in");
        document.documentElement.removeAttribute("data-dh-turnstile-challenge");
      }

      // Pre-warm TCP + TLS socket connection to reduce API latency by 100-200ms
      // Strictly avoid prematurely invoking Turnstile.getToken() to prevent widget race condition / token resets
      if (typeof fetch === "function") {
        fetch("/api/v2/xeng/check-in-secure", { method: "OPTIONS", keepalive: true }).catch(function() {});
      }

      // Preload Cloudflare Turnstile script if not already present, ensuring widget script is parsed ahead of drop
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

  function handleStrike() {
    // Single Precision Shot: strictly prevent duplicate executions
    if (strikeInProgress) return;
    strikeInProgress = true;
    setTimeout(function() {
      strikeInProgress = false;
    }, 6000);

    try {
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.removeAttribute("data-dh-checked-in");
        document.documentElement.removeAttribute("data-dh-turnstile-challenge");
      }

      var win = window;
      var appInst = getAppInstance();
      var appExecuted = false;

      if (appInst) {
        if (appInst.state) {
          // Explicit targeted guard reset only - avoid broad regex pattern matching
          appInst.state.todayCheckedIn = false;
          if ("isCheckedIn" in appInst.state) appInst.state.isCheckedIn = false;
          if ("checkInLocked" in appInst.state) appInst.state.checkInLocked = false;
          if ("hasClaimed" in appInst.state) appInst.state.hasClaimed = false;
          if ("isCheckingIn" in appInst.state) appInst.state.isCheckingIn = false;
        }

        // Priority 1A: Exact checkIn function
        if (typeof appInst.checkIn === "function") {
          try {
            var ret = appInst.checkIn();
            appExecuted = true;
            if (ret && typeof ret.then === "function") {
              ret.then(function() {
                markCheckedIn();
              }).catch(function() {});
            }
          } catch (e) {}
        }

        // Priority 1B: Method name regex matching
        if (!appExecuted) {
          for (var m of Object.keys(appInst)) {
            if (typeof appInst[m] === "function" && /^(check_?in|claim|diem_?danh|attendance|reward)/i.test(m)) {
              try {
                var retB = appInst[m].call(appInst);
                appExecuted = true;
                if (retB && typeof retB.then === "function") {
                  retB.then(function() {
                    markCheckedIn();
                  }).catch(function() {});
                }
                break;
              } catch (e) {}
            }
          }
        }

        // Priority 1C: Deep source code search (works even with obfuscation/minification)
        if (!appExecuted) {
          for (var m2 of Object.keys(appInst)) {
            var fn = appInst[m2];
            if (typeof fn === "function" && m2 !== "init" && m2 !== "setupTabs") {
              try {
                var code = fn.toString();
                if (code.includes("CheckInTurnstile") || code.includes("check-in") || code.includes("todayCheckedIn")) {
                  var retC = fn.call(appInst);
                  appExecuted = true;
                  if (retC && typeof retC.then === "function") {
                    retC.then(function() {
                      markCheckedIn();
                    }).catch(function() {});
                  }
                  break;
                }
              } catch (e) {}
            }
          }
        }
      }

      // Priority 2: Unblock and trigger real DOM button ONLY IF in-page app was not executed
      if (!appExecuted) {
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
          try {
            btn.click();
          } catch (e) {}
        }
      }

      // Priority 3: Direct API fallback ONLY IF neither app nor button could be triggered
      if (!appExecuted && !document.getElementById("btnCheckIn") && !document.getElementById("caffiliate-checkin-btn")) {
        (async function() {
          try {
            var csrfMeta = document.querySelector('meta[name="csrf-token"]');
            var csrfToken =
              (appInst && appInst.state && appInst.state.csrfToken) ||
              (csrfMeta ? csrfMeta.getAttribute("content") : "") ||
              "";
            var googleId = (appInst && appInst.state && appInst.state.googleId) || "";
            var turnstileToken = win._dh_turnstile_prewarmed || "";
            if (!turnstileToken && win.CheckInTurnstile && typeof win.CheckInTurnstile.getToken === "function") {
              turnstileToken = await win.CheckInTurnstile.getToken();
            }
            var ts = Date.now().toString();
            var nonce = Math.random().toString(36).substring(2, 15);
            var signature = "";
            if (appInst && typeof appInst.generateSignature === "function") {
              signature = await appInst.generateSignature(ts, nonce);
            }
            var resp = await fetch("/api/v2/xeng/check-in-secure", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-TOKEN": csrfToken,
              },
              body: JSON.stringify({
                googleId: googleId,
                timestamp: ts,
                nonce: nonce,
                turnstileToken: turnstileToken,
                signature: signature,
              }),
            });
            if (resp.ok) {
              markCheckedIn();
            }
          } catch (err) {}
        })();
      }
    } catch (err) {}
  }

  window.addEventListener("dh-caffiliate-prewarm", handlePrewarm);
  window.addEventListener("dh-caffiliate-strike", handleStrike);
})();
