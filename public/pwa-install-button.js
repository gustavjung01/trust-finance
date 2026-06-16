(function () {
  var deferredPrompt = null;
  var installed = false;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function isInAppBrowser() {
    return /FBAN|FBAV|FB_IAB|Instagram|Zalo/i.test(navigator.userAgent || "");
  }

  function buildInstallGuide() {
    var text = "";

    if (isInAppBrowser()) {
      text = isIOS()
        ? "Bạn đang mở trong Facebook/Zalo. Hãy bấm Copy link, mở Safari, dán link rồi chọn Chia sẻ > Thêm vào Màn hình chính."
        : "Bạn đang mở trong Facebook/Zalo. Hãy bấm nút Chrome/Edge ở thông báo bên dưới, rồi chọn Cài ứng dụng trong trình duyệt.";
    } else if (isIOS()) {
      text = "Trên iPhone: bấm nút Chia sẻ của Safari, rồi chọn Thêm vào Màn hình chính.";
    } else if (isAndroid()) {
      text = "Trên Android: mở bằng Chrome hoặc Edge, sau đó chọn Cài ứng dụng hoặc Thêm vào màn hình chính.";
    } else {
      text = "Mở website bằng Chrome hoặc Edge, rồi dùng nút cài đặt trên thanh địa chỉ nếu trình duyệt hỗ trợ.";
    }

    return text;
  }

  async function handleInstallClick() {
    if (installed || isStandalone()) {
      alert("App đã được mở ở chế độ ứng dụng.");
      return;
    }

    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        var choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === "accepted") {
          installed = true;
          updateButtons();
        }
      } finally {
        deferredPrompt = null;
      }
      return;
    }

    alert(buildInstallGuide());
  }

  function makeButton(extraClass) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = extraClass;
    button.textContent = isStandalone() ? "Đã cài app" : "Tải app";
    button.setAttribute("data-pwa-install-button", "true");
    button.addEventListener("click", handleInstallClick);
    return button;
  }

  function updateButtons() {
    var text = installed || isStandalone() ? "Đã cài app" : "Tải app";
    document.querySelectorAll("[data-pwa-install-button]").forEach(function (button) {
      button.textContent = text;
    });
  }

  function addHeroButton() {
    if (document.getElementById("pwaInstallHeroButton")) return;

    var heroActions = document.querySelector("main section .flex.flex-wrap.justify-center.gap-4");
    if (!heroActions) return;

    var button = makeButton("px-8 py-3 rounded-full font-bold shadow-lg bg-white text-[#0F3B75] border-2 border-[#0F3B75] hover:bg-blue-50 transition");
    button.id = "pwaInstallHeroButton";
    heroActions.appendChild(button);
  }

  function addMobileButton() {
    if (document.getElementById("pwaInstallMobileButton")) return;

    var mobileCta = document.getElementById("mobileCta");
    if (!mobileCta) return;

    mobileCta.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";

    var button = makeButton("bg-[#F58220] text-white py-2 rounded-lg font-bold text-xs");
    button.id = "pwaInstallMobileButton";
    mobileCta.appendChild(button);
  }

  function init() {
    addHeroButton();
    addMobileButton();
    updateButtons();
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    updateButtons();
  });

  window.addEventListener("appinstalled", function () {
    installed = true;
    deferredPrompt = null;
    updateButtons();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
