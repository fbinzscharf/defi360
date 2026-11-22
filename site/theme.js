// Theme handling for defi360.news.
// The page follows the visitor's system setting until they use the toggle;
// after that their choice is remembered in this browser.

(function () {
  var KEY = "defi360-theme";
  var root = document.documentElement;

  function stored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function system() {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var button = document.querySelector(".theme-toggle");
    if (button) {
      button.setAttribute(
        "aria-label",
        theme === "light" ? "Switch to dark theme" : "Switch to light theme"
      );
    }
  }

  // Runs immediately (the script is loaded in <head>) so the first paint is in the right theme.
  apply(stored() || system());

  document.addEventListener("DOMContentLoaded", function () {
    apply(root.getAttribute("data-theme"));
    var button = document.querySelector(".theme-toggle");
    if (!button) return;
    button.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      apply(next);
      try {
        window.localStorage.setItem(KEY, next);
      } catch (error) {
        // Storage is unavailable; the choice lasts for this page view only.
      }
    });
  });

  // Follow system changes only while the visitor has not chosen a theme.
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function () {
    if (!stored()) apply(system());
  });
})();
