(() => {
  const DESKTOP_QUERY = "(min-width: 980px)";

  function desktopMode() {
    return window.matchMedia(DESKTOP_QUERY).matches;
  }

  function elements() {
    return {
      toggle: document.querySelector("#desktopMenuToggle"),
      nav: document.querySelector("#primaryNavigation")
    };
  }

  function closeMenu() {
    const { toggle, nav } = elements();
    if (!toggle || !nav) return;
    nav.classList.remove("desktop-open");
    toggle.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    const { toggle, nav } = elements();
    if (!toggle || !nav || !desktopMode()) return;
    nav.classList.add("desktop-open");
    toggle.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
  }

  function toggleMenu() {
    const { nav } = elements();
    if (!nav || !desktopMode()) return;
    if (nav.classList.contains("desktop-open")) closeMenu();
    else openMenu();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const { toggle, nav } = elements();
    if (!toggle || !nav) return;

    toggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu();
    });

    nav.addEventListener("click", event => {
      if (desktopMode() && event.target.closest(".nav-button")) closeMenu();
    });

    document.addEventListener("click", event => {
      if (!desktopMode() || !nav.classList.contains("desktop-open")) return;
      if (nav.contains(event.target) || toggle.contains(event.target)) return;
      closeMenu();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMenu();
    });

    const media = window.matchMedia(DESKTOP_QUERY);
    media.addEventListener?.("change", closeMenu);
    closeMenu();
  });
})();
