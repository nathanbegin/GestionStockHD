(() => {
  const NOTE_CLASS = "tour-note-scroll";
  let refreshTimer = null;

  function installStyles() {
    if (document.querySelector("#tourNoteScrollStyles")) return;
    const style = document.createElement("style");
    style.id = "tourNoteScrollStyles";
    style.textContent = `
      .tour-card .${NOTE_CLASS} {
        max-height: min(22dvh, 150px);
        margin: 12px 0;
        padding: 11px 13px;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--surface-2);
        line-height: 1.4;
        scrollbar-gutter: stable;
      }

      .tour-card .${NOTE_CLASS} strong {
        position: sticky;
        top: 0;
        display: inline-block;
        margin-right: 4px;
        background: var(--surface-2);
      }

      @media (max-height: 720px) {
        .tour-card .${NOTE_CLASS} {
          max-height: 110px;
        }
      }
    `;
    document.head.append(style);
  }

  function isNoteParagraph(element) {
    if (!(element instanceof HTMLParagraphElement)) return false;
    const strong = element.querySelector(":scope > strong:first-child");
    return /^Note\s*:/i.test(strong?.textContent?.trim() || "");
  }

  function enhanceNotes() {
    document.querySelectorAll(".tour-card > p").forEach(paragraph => {
      if (!isNoteParagraph(paragraph) || paragraph.classList.contains(NOTE_CLASS)) return;
      paragraph.classList.add(NOTE_CLASS);
      paragraph.tabIndex = 0;
      paragraph.setAttribute("role", "region");
      paragraph.setAttribute("aria-label", "Note de l’article — faire défiler verticalement");

      // Le ramassage utilise les gestes horizontaux pour changer d’article.
      // Les gestes démarrés dans la note doivent rester réservés à son défilement vertical.
      ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup", "wheel"].forEach(type => {
        paragraph.addEventListener(type, event => event.stopPropagation(), { passive: true });
      });
    });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceNotes, 0);
  }

  function initialize() {
    installStyles();
    enhanceNotes();
    const main = document.querySelector("#appMain");
    if (main) new MutationObserver(scheduleRefresh).observe(main, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
