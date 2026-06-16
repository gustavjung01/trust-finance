(function () {
  var STATE_KEY = "shbfinance_pwa_install_card_state";
  var deferredPrompt = null;
  var installed = false;

  function getState() {
    try {
      return localStorage.getItem(STATE_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function setState(nextState) {
    try {
      localStorage.setItem(STATE_KEY, nextState);
    } catch (err) {}
  }

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

  function shouldHideCard() {
    var state = getState();
    return installed || isStandalone() || state === "installed" || state === "dismissed";
  }

  function hideCard(nextState) {
    var card = document.getElementById("pwaInstallHomeCard");
    if (nextState) setState(nextState);
    if (card) card.remove();
  }

  function buildInstallGuide() {
    if (isInAppBrowser()) {
      return isIOS()
        ? "Bạn đang mở trong Facebook/Zalo. Hãy bấm Copy link, mở Safari, dán link rồi chọn Chia sẻ > Thêm vào Màn hình chính."
        : "Bạn đang mở trong Facebook/Zalo. Hãy bấm nút Chrome/Edge ở thông báo bên dưới, rồi chọn Cài ứng dụng trong trình duyệt.";
    }

    if (isIOS()) {
      return "Trên iPhone: bấm nút Chia sẻ của Safari, rồi chọn Thêm vào Màn hình chính. Nếu đã thêm rồi, bấm nút X để ẩn khung này.";
    }

    if (isAndroid()) {
      return "Trên Android: mở bằng Chrome hoặc Edge, sau đó chọn Cài ứng dụng hoặc Thêm vào màn hình chính.";
    }

    return "Mở website bằng Chrome hoặc Edge, rồi dùng nút cài đặt trên thanh địa chỉ nếu trình duyệt hỗ trợ.";
  }

  async function handleInstallClick() {
    if (installed || isStandalone()) {
      hideCard("installed");
      return;
    }

    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        var choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === "accepted") {
          installed = true;
          hideCard("installed");
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
    button.textContent = "Tải app";
    button.setAttribute("data-pwa-install-button", "true");
    button.addEventListener("click", handleInstallClick);
    return button;
  }

  function updateButtons() {
    if (shouldHideCard()) {
      hideCard(getState() === "installed" ? null : undefined);
      return;
    }

    document.querySelectorAll("[data-pwa-install-button]").forEach(function (button) {
      button.textContent = "Tải app";
    });
  }

  function addHomeInstallCard() {
    if (shouldHideCard()) {
      hideCard();
      return;
    }

    if (document.getElementById("pwaInstallHomeCard")) return;

    var heroActions = document.querySelector("main section .flex.flex-wrap.justify-center.gap-4");
    if (!heroActions) return;

    var card = document.createElement("div");
    card.id = "pwaInstallHomeCard";
    card.className = "relative mx-auto mt-6 max-w-2xl rounded-3xl border border-blue-100 bg-white p-4 pr-12 shadow-xl md:flex md:items-center md:justify-between md:gap-5";

    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Ẩn nút tải app");
    closeButton.className = "absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-lg font-bold leading-none text-gray-500 transition hover:bg-gray-200 hover:text-gray-700";
    closeButton.innerHTML = "&times;";
    closeButton.addEventListener("click", function () {
      hideCard("dismissed");
    });

    var copy = document.createElement("div");
    copy.className = "mb-4 text-left md:mb-0";
    copy.innerHTML = [
      "<div class='text-sm font-bold uppercase tracking-wide text-[#F58220]'>Cài nhanh trên điện thoại</div>",
      "<div class='mt-1 text-xl font-extrabold text-[#0F3B75]'>Tải app SHBFinance ra màn hình chính</div>",
      "<div class='mt-1 text-sm leading-relaxed text-gray-600'>Mở nhanh như app, tiện quay lại đăng ký tư vấn và chat hỗ trợ.</div>"
    ].join("");

    var button = makeButton("w-full rounded-2xl bg-[#F58220] px-6 py-3 text-base font-extrabold text-white shadow-lg transition hover:bg-orange-600 md:w-auto md:min-w-32");
    button.id = "pwaInstallHomeButton";

    card.appendChild(closeButton);
    card.appendChild(copy);
    card.appendChild(button);
    heroActions.insertAdjacentElement("afterend", card);
  }

  function removeOldFixedMenuButton() {
    var oldButton = document.getElementById("pwaInstallMobileButton");
    if (oldButton) oldButton.remove();

    var mobileCta = document.getElementById("mobileCta");
    if (mobileCta) mobileCta.style.gridTemplateColumns = "";
  }

  function init() {
    removeOldFixedMenuButton();

    if (isStandalone()) {
      hideCard("installed");
      return;
    }

    addHomeInstallCard();
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
    hideCard("installed");
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
