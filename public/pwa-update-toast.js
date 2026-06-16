(function () {
  var KEY = "shbfinance_app_version";
  var busy = false;
  var updateReady = false;

  function injectStyle() {
    if (document.getElementById("pwa-update-toast-style")) return;

    var style = document.createElement("style");
    style.id = "pwa-update-toast-style";
    style.textContent = [
      ".pwa-update-toast{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:999998;width:min(420px,calc(100% - 24px));display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid rgba(15,59,117,.18);border-radius:18px;background:rgba(15,59,117,.96);color:#fff;padding:12px 14px;box-shadow:0 18px 60px rgba(0,0,0,.35);backdrop-filter:blur(14px)}",
      ".pwa-update-toast strong{display:block;font-size:14px}",
      ".pwa-update-toast span{display:block;color:rgba(255,255,255,.78);font-size:12px;line-height:1.35}",
      ".pwa-update-toast button{border:0;border-radius:999px;background:#fff;color:#0F3B75;font-weight:900;padding:9px 13px;cursor:pointer;white-space:nowrap}"
    ].join("");
    document.head.appendChild(style);
  }

  function showToast() {
    if (document.getElementById("pwa-update-toast")) return;
    injectStyle();

    var box = document.createElement("div");
    box.id = "pwa-update-toast";
    box.className = "pwa-update-toast";
    box.innerHTML =
      "<div><strong>Có bản mới</strong><span>Bấm cập nhật để dùng phiên bản mới nhất.</span></div>" +
      "<button type='button'>Cập nhật</button>";

    box.querySelector("button").addEventListener("click", function () {
      window.location.reload();
    });

    document.body.appendChild(box);
  }

  function swUpdate() {
    if (!("serviceWorker" in navigator)) return Promise.resolve();
    return navigator.serviceWorker.getRegistration("/").then(function (reg) {
      if (reg && reg.update) return reg.update();
    }).catch(function () {});
  }

  function check() {
    if (busy || updateReady) return;
    busy = true;

    fetch("/app-version.json?t=" + Date.now(), {
      cache: "no-store",
      headers: { Accept: "application/json" }
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        var next = data && String(data.version || data.builtAt || "");
        if (!next) return;

        var current = localStorage.getItem(KEY);

        if (!current) {
          localStorage.setItem(KEY, next);
          return;
        }

        if (current !== next) {
          localStorage.setItem(KEY, next);
          updateReady = true;
          swUpdate().then(showToast);
        }
      })
      .catch(function () {})
      .finally(function () {
        busy = false;
      });
  }

  function checkVisible() {
    if (document.visibilityState === "visible") check();
  }

  window.addEventListener("pageshow", check);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", checkVisible);
  setInterval(checkVisible, 60000);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", check, { once: true });
  } else {
    check();
  }
})();
