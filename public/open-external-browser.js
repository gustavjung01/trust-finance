(function () {
  var ua = navigator.userAgent || "";
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  var isFacebook = /FBAN|FBAV|FB_IAB|Instagram/i.test(ua);
  var isZalo = /Zalo/i.test(ua);
  var isInApp = isFacebook || isZalo;

  if (!isInApp) return;

  var url = window.location.href;
  var encoded = encodeURIComponent(url);
  var hostPath = window.location.host + window.location.pathname + window.location.search + window.location.hash;

  function openChrome() {
    if (!isAndroid) {
      copyLink();
      return;
    }

    window.location.href =
      "intent://" + hostPath +
      "#Intent;scheme=https;package=com.android.chrome;" +
      "S.browser_fallback_url=" + encoded + ";end";
  }

  function openEdge() {
    if (!isAndroid) {
      copyLink();
      return;
    }

    window.location.href =
      "intent://" + hostPath +
      "#Intent;scheme=https;package=com.microsoft.emmx;" +
      "S.browser_fallback_url=" + encoded + ";end";
  }

  function copyLink() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        alert("Đã copy link. Hãy mở Safari hoặc Chrome rồi dán link này để dùng ổn định hơn.");
      }).catch(function () {
        prompt("Copy link này rồi mở bằng Safari hoặc Chrome:", url);
      });
    } else {
      prompt("Copy link này rồi mở bằng Safari hoặc Chrome:", url);
    }
  }

  function inject() {
    if (document.getElementById("open-external-browser-tip")) return;

    var box = document.createElement("div");
    box.id = "open-external-browser-tip";
    box.style.cssText = [
      "position:fixed",
      "left:12px",
      "right:12px",
      "bottom:calc(14px + env(safe-area-inset-bottom))",
      "z-index:999999",
      "background:#111827",
      "color:#fff",
      "border-radius:16px",
      "padding:14px",
      "box-shadow:0 12px 40px rgba(0,0,0,.35)",
      "font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"
    ].join(";");

    box.innerHTML = [
      "<div style='font-weight:800;margin-bottom:6px'>Đang mở trong Facebook/Zalo</div>",
      "<div style='font-size:13px;line-height:1.4;opacity:.9;margin-bottom:10px'>",
      isIOS
        ? "Để cài ra màn hình chính trên iPhone, hãy mở link bằng Safari rồi chọn Chia sẻ > Thêm vào Màn hình chính."
        : "Để cài app hoặc tải nội dung ổn định, hãy mở bằng Chrome hoặc Edge.",
      "</div>",
      "<div style='display:flex;gap:8px;flex-wrap:wrap'>",
      isAndroid ? "<button id='openChromeBtn' style='padding:9px 12px;border:0;border-radius:999px;font-weight:700'>Chrome</button>" : "",
      isAndroid ? "<button id='openEdgeBtn' style='padding:9px 12px;border:0;border-radius:999px;font-weight:700'>Edge</button>" : "",
      "<button id='copyLinkBtn' style='padding:9px 12px;border:0;border-radius:999px;font-weight:700'>Copy link</button>",
      "<button id='closeOpenBrowserTip' style='padding:9px 12px;border:1px solid #555;border-radius:999px;background:transparent;color:#fff'>Đóng</button>",
      "</div>"
    ].join("");

    document.body.appendChild(box);

    var chromeBtn = document.getElementById("openChromeBtn");
    var edgeBtn = document.getElementById("openEdgeBtn");
    var copyBtn = document.getElementById("copyLinkBtn");
    var closeBtn = document.getElementById("closeOpenBrowserTip");

    if (chromeBtn) chromeBtn.onclick = openChrome;
    if (edgeBtn) edgeBtn.onclick = openEdge;
    if (copyBtn) copyBtn.onclick = copyLink;
    if (closeBtn) closeBtn.onclick = function () {
      box.remove();
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();
