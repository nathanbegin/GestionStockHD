(() => {
  const CHECK_INTERVAL = 180;
  const LEAVE_GRACE_MS = 1200;
  let leaveRequestedUntil = 0;

  function appVisible() {
    const shell = document.querySelector("#appShell");
    return Boolean(shell && !shell.hidden);
  }

  function eventsSelected() {
    return Boolean(document.querySelector("#eventsNavButton.active"));
  }

  function eventsRendered() {
    const main = document.querySelector("#appMain");
    const title = document.querySelector("#pageTitle");
    return Boolean(main?.querySelector("[data-events-root]") && title?.textContent === "Événements");
  }

  function markLeavingEvents() {
    leaveRequestedUntil = Date.now() + LEAVE_GRACE_MS;
    const eventsButton = document.querySelector("#eventsNavButton");
    eventsButton?.classList.remove("active");
    eventsButton?.removeAttribute("aria-current");
  }

  function restoreEventsView() {
    if (Date.now() < leaveRequestedUntil) return;
    if (!appVisible() || !eventsSelected() || eventsRendered()) return;
    document.querySelector("#eventsNavButton")?.click();
  }

  document.addEventListener("click", event => {
    const standardNav = event.target.closest(".bottom-nav [data-nav]");
    if (standardNav) {
      markLeavingEvents();
      return;
    }

    if (event.target.closest("#eventsNavButton")) {
      leaveRequestedUntil = 0;
    }
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    window.setInterval(restoreEventsView, CHECK_INTERVAL);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") restoreEventsView();
    });
  });
})();
