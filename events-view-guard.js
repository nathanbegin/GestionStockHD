(() => {
  const CHECK_INTERVAL = 180;

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

  function restoreEventsView() {
    if (!appVisible() || !eventsSelected() || eventsRendered()) return;
    document.querySelector("#eventsNavButton")?.click();
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.setInterval(restoreEventsView, CHECK_INTERVAL);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") restoreEventsView();
    });
  });
})();
