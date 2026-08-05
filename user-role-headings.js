(() => {
  let scheduled = false;

  function enhanceRoleGroups() {
    scheduled = false;
    const management = document.querySelector("#userManagementV2");
    if (!management) return;

    const roleOverview = management.querySelector(".um-overview");
    const grid = roleOverview?.querySelector(".um-group-grid");
    if (!grid) return;

    [...grid.children].forEach(card => {
      if (!card.classList.contains("um-group-card") || card.closest(".um-role-group")) return;
      const title = card.querySelector(":scope > h3");
      if (!title) return;

      const wrapper = document.createElement("section");
      wrapper.className = "um-role-group";

      const heading = document.createElement("h3");
      heading.className = "um-role-heading";
      heading.innerHTML = `<span aria-hidden="true"></span>${title.innerHTML}`;

      title.remove();
      card.before(wrapper);
      wrapper.append(heading, card);
    });
  }

  function scheduleEnhancement() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(enhanceRoleGroups);
  }

  function installStyles() {
    if (document.querySelector("#userRoleHeadingStyles")) return;
    const style = document.createElement("style");
    style.id = "userRoleHeadingStyles";
    style.textContent = `
      #userManagementV2 .um-overview:first-of-type .um-group-grid {
        align-items: start;
      }

      #userManagementV2 .um-role-group {
        display: grid;
        gap: .65rem;
        min-width: 0;
      }

      #userManagementV2 .um-role-heading {
        display: flex;
        align-items: center;
        gap: .65rem;
        margin: 0;
        padding: 0 .15rem;
        font-size: clamp(1.4rem, 4vw, 1.8rem);
        line-height: 1.08;
        font-weight: 900;
        letter-spacing: -.025em;
        color: var(--text);
      }

      #userManagementV2 .um-role-heading > span {
        width: .35rem;
        height: 1.6rem;
        flex: 0 0 auto;
        border-radius: 999px;
        background: var(--brand);
      }

      #userManagementV2 .um-role-group > .um-group-card {
        width: 100%;
      }

      @media (max-width: 560px) {
        #userManagementV2 .um-role-group {
          gap: .55rem;
        }

        #userManagementV2 .um-role-heading {
          font-size: 1.55rem;
        }
      }
    `;
    document.head.append(style);
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(scheduleEnhancement).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
    scheduleEnhancement();
  });
})();
