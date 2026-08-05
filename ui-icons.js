(() => {
  const ICONS = {
    camera: `
      <svg class="ui-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8.5 5 10 3h4l1.5 2H19a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3.5ZM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>
      </svg>`,
    pickupHand: `
      <svg class="ui-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 5h8M4 9h8M4 13h6"/>
          <path d="M15 13V8.5a1.5 1.5 0 0 1 3 0V14l1.2-.9a1.4 1.4 0 0 1 1.9 2l-2.8 3.5a3.5 3.5 0 0 1-2.7 1.4h-1.4a3 3 0 0 1-2.1-.9l-2.2-2.2a1.4 1.4 0 0 1 2-2l1.1 1.1v-2.5a1.5 1.5 0 0 1 2-1.4"/>
        </g>
      </svg>`
  };

  function setIcon(element, iconName) {
    if (!element || element.dataset.uiIcon === iconName) return;
    element.innerHTML = ICONS[iconName];
    element.dataset.uiIcon = iconName;
    element.setAttribute("aria-hidden", "true");
  }

  function updateStaticNavigation() {
    setIcon(document.querySelector('[data-nav="scan"] > span'), "camera");
    setIcon(document.querySelector('[data-nav="pickups"] > span'), "pickupHand");
  }

  function updateQuickActions() {
    setIcon(document.querySelector('[data-action="go"][data-view="scan"] > .icon'), "camera");
    setIcon(document.querySelector('[data-action="go"][data-view="pickups"] > .icon'), "pickupHand");
  }

  function updateIcons() {
    updateStaticNavigation();
    updateQuickActions();
  }

  function installStyles() {
    if (document.querySelector("#uiIconStyles")) return;
    const style = document.createElement("style");
    style.id = "uiIconStyles";
    style.textContent = `
      .ui-icon-svg {
        display: block;
        width: 1em;
        height: 1em;
        fill: currentColor;
        overflow: visible;
      }
      .bottom-nav .nav-button > span[data-ui-icon] {
        display: grid;
        place-items: center;
      }
      .bottom-nav .nav-button > span[data-ui-icon] .ui-icon-svg {
        width: 1.45rem;
        height: 1.45rem;
      }
      .action-card > .icon[data-ui-icon] {
        display: grid;
        place-items: center;
      }
      .action-card > .icon[data-ui-icon] .ui-icon-svg {
        width: 2.15rem;
        height: 2.15rem;
      }
    `;
    document.head.append(style);
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    updateIcons();

    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(updateQuickActions).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
  });
})();
