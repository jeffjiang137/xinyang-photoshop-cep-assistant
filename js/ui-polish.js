(function () {
  "use strict";

  if (window.__xinyangUiPolishV2138) return;
  window.__xinyangUiPolishV2138 = true;

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }


  function disableNavigationTooltips() {
    all(".nav-button").forEach(function (node) {
      var label = node.getAttribute("aria-label") || node.getAttribute("title") || "";
      if (!label) {
        var text = one(".nav-label", node);
        label = text ? text.textContent : "";
      }
      label = String(label || "").replace(/^\s+|\s+$/g, "");
      if (label) node.setAttribute("aria-label", label);
      node.removeAttribute("title");
      node.removeAttribute("data-ui-tooltip");
      node.removeAttribute("data-ui-native-title");
    });
  }

  function decorateTooltips() {
    var selector = [
      ".words-header-icon",
      ".words-public-tools button",
      ".words-action-toolbar button",
      ".words-align-grid button",
      ".common-align-row button",
      ".common-layout-row button",
      ".common-flip-row button",
      ".common-tool-more"
    ].join(",");

    all(selector).forEach(function (node) {
      if (node.hasAttribute("data-ui-tooltip")) return;
      var label = node.getAttribute("aria-label") || node.getAttribute("title") || "";
      label = String(label).replace(/^\s+|\s+$/g, "");
      if (!label) return;
      node.setAttribute("data-ui-tooltip", label);
      /* 关闭浏览器原生即时提示，避免与延迟提示重叠。 */
      if (node.hasAttribute("title")) node.setAttribute("data-ui-native-title", node.getAttribute("title"));
      node.removeAttribute("title");
    });
  }

  function closeDrawer() {
    var activeItem = one(".common-tool-item.detail-row-active");
    var more = activeItem ? one("[data-common-more]", activeItem) : null;
    if (more) {
      more.click();
      return;
    }
    var action = activeItem ? one("[data-common-action]", activeItem) : null;
    if (action) {
      action.click();
      return;
    }
    var drawer = one("#common-tools-parameter-drawer");
    if (!drawer) return;
    drawer.classList.add("drawer-collapsed");
    drawer.setAttribute("aria-hidden", "true");
    all("#common-tools-parameter-drawer .tool-detail").forEach(function (view) {
      view.classList.remove("active");
    });
    all(".common-tool-item.detail-row-active").forEach(function (item) {
      item.classList.remove("detail-row-active");
    });
  }

  function bindDrawer() {
    var drawer = one("#common-tools-parameter-drawer");
    if (!drawer || drawer.__xinyangObserved) return;
    drawer.__xinyangObserved = true;
    var observer = new MutationObserver(function () {
      drawer.setAttribute(
        "aria-hidden",
        drawer.classList.contains("drawer-collapsed") ? "true" : "false"
      );
      decorateTooltips();
    });
    observer.observe(drawer, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class"]
    });
    drawer.setAttribute(
      "aria-hidden",
      drawer.classList.contains("drawer-collapsed") ? "true" : "false"
    );
  }

  function bindEscape() {
    if (document.__xinyangEscapeBound) return;
    document.__xinyangEscapeBound = true;
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" && event.keyCode !== 27) return;
      var openPopover = one("#typography-panel .words-inline-popover:not([hidden]), #typography-panel .words-preset-popup:not([hidden]), #typography-panel .words-font-results:not([hidden])");
      if (openPopover) {
        openPopover.hidden = true;
        all('#typography-panel [aria-expanded="true"]').forEach(function (node) { node.setAttribute("aria-expanded", "false"); });
        return;
      }
      var drawer = one("#common-tools-parameter-drawer");
      if (drawer && !drawer.classList.contains("drawer-collapsed")) closeDrawer();
    });
  }

  function addControlTitles() {
    all("input[type='number'], input[type='text'], select").forEach(function (node) {
      if (node.getAttribute("aria-label") || node.getAttribute("title")) return;
      var label = node.closest("label");
      var text = label && label.querySelector("span") ? label.querySelector("span").textContent : "";
      text = String(text || node.getAttribute("placeholder") || "").replace(/^\s+|\s+$/g, "");
      if (text) node.setAttribute("aria-label", text);
    });
  }

  function positionWordsPresetPopup(popup) {
    if (!popup || popup.hidden) return;
    var anchor = popup.parentElement;
    var typographyPanel = one("#typography-panel");
    if (!anchor || !typographyPanel) return;

    popup.style.right = "auto";
    popup.style.left = "0px";
    popup.style.boxSizing = "border-box";

    var panelRect = typographyPanel.getBoundingClientRect();
    var anchorRect = anchor.getBoundingClientRect();
    var availableWidth = Math.max(
      96,
      Math.floor(Math.min(window.innerWidth - 8, panelRect.right - 4) -
        Math.max(4, panelRect.left + 4))
    );
    popup.style.width = Math.min(178, availableWidth) + "px";
    popup.style.maxWidth = availableWidth + "px";

    var popupRect = popup.getBoundingClientRect();
    var minimumLeft = Math.max(4, panelRect.left + 4);
    var maximumRight = Math.min(window.innerWidth - 4, panelRect.right - 4);
    var targetLeft = popupRect.left;
    if (targetLeft < minimumLeft) targetLeft = minimumLeft;
    if (targetLeft + popupRect.width > maximumRight) {
      targetLeft = maximumRight - popupRect.width;
    }
    targetLeft = Math.max(minimumLeft, targetLeft);
    popup.style.left = Math.round(targetLeft - anchorRect.left) + "px";
  }

  function positionOpenWordsPresetPopups() {
    all("#typography-panel .words-preset-popup:not([hidden])").forEach(function (popup) {
      positionWordsPresetPopup(popup);
    });
  }

  function bindWordsPresetPopupBounds() {
    var popups = all("#typography-panel .words-preset-popup");
    popups.forEach(function (popup) {
      if (popup.__xinyangBoundsObserved) return;
      popup.__xinyangBoundsObserved = true;
      var observer = new MutationObserver(function () {
        if (!popup.hidden) {
          window.setTimeout(function () { positionWordsPresetPopup(popup); }, 0);
        }
      });
      observer.observe(popup, { attributes: true, attributeFilter: ["hidden"] });
    });
    if (!window.__xinyangWordsPresetResizeBound) {
      window.__xinyangWordsPresetResizeBound = true;
      window.addEventListener("resize", function () {
        window.setTimeout(positionOpenWordsPresetPopups, 0);
      });
    }
  }

  function init() {
    disableNavigationTooltips();
    decorateTooltips();
    bindDrawer();
    bindEscape();
    addControlTitles();
    bindWordsPresetPopupBounds();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
