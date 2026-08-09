(() => {
  const originalFetch = window.fetch.bind(window);
  let nextColorMode = "color";
  let exportButton = null;

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url || "";
  }

  function requestMethod(input, init) {
    return String(init?.method || input?.method || "GET").toUpperCase();
  }

  function browserClock() {
    const now = new Date();
    let timeZone = "";
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      timeZone = "";
    }

    return {
      clientGeneratedAt: now.toISOString(),
      clientTimeZone: timeZone,
      clientUtcOffsetMinutes: -now.getTimezoneOffset()
    };
  }

  function installChoiceStyles() {
    if (document.querySelector("#pdfColorChoiceStyles")) return;
    const style = document.createElement("style");
    style.id = "pdfColorChoiceStyles";
    style.textContent = `
      .pdf-choice-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1400;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(35, 28, 24, .46);
        backdrop-filter: blur(2px);
      }
      .pdf-choice-card {
        width: min(430px, 100%);
        padding: 20px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--surface);
        box-shadow: 0 20px 50px rgba(35, 28, 24, .22);
      }
      .pdf-choice-card h2 { margin: 0 0 6px; }
      .pdf-choice-card p { margin: 0; }
      .pdf-choice-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 18px;
      }
      .pdf-choice-option {
        min-height: 88px;
        display: grid;
        place-items: center;
        gap: 5px;
        padding: 14px 10px;
        border: 1px solid var(--line);
        border-radius: 15px;
        background: var(--surface-2, #f7f3f0);
        color: var(--text);
        text-align: center;
        cursor: pointer;
      }
      .pdf-choice-option:hover,
      .pdf-choice-option:focus-visible {
        border-color: var(--brand);
        outline: none;
      }
      .pdf-choice-preview {
        width: 42px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 900;
      }
      .pdf-choice-preview.color {
        background: #f96302;
        color: #fff;
      }
      .pdf-choice-preview.bw {
        background: #333;
        color: #fff;
      }
      .pdf-choice-option strong { font-size: 15px; }
      .pdf-choice-cancel {
        width: 100%;
        margin-top: 10px;
      }
      @media (max-width: 420px) {
        .pdf-choice-card { padding: 17px; }
        .pdf-choice-options { gap: 8px; }
      }
    `;
    document.head.appendChild(style);
  }

  function closeChoice() {
    document.querySelector("#pdfColorChoiceBackdrop")?.remove();
    exportButton = null;
  }

  function continueExport(mode) {
    const button = exportButton;
    nextColorMode = mode === "bw" ? "bw" : "color";
    closeChoice();
    if (!button?.isConnected) return;
    button.dataset.pdfChoiceApproved = "1";
    button.click();
  }

  function openChoice(button) {
    installChoiceStyles();
    document.querySelector("#pdfColorChoiceBackdrop")?.remove();
    exportButton = button;

    const backdrop = document.createElement("div");
    backdrop.id = "pdfColorChoiceBackdrop";
    backdrop.className = "dialog-backdrop pdf-choice-backdrop";
    backdrop.innerHTML = `
      <section class="pdf-choice-card" role="dialog" aria-modal="true" aria-labelledby="pdfColorChoiceTitle">
        <h2 id="pdfColorChoiceTitle">Type de PDF</h2>
        <p class="muted">Comment veux-tu générer ce document?</p>
        <div class="pdf-choice-options">
          <button class="pdf-choice-option" type="button" data-pdf-color-mode="color">
            <span class="pdf-choice-preview color" aria-hidden="true">PDF</span>
            <strong>Couleur</strong>
          </button>
          <button class="pdf-choice-option" type="button" data-pdf-color-mode="bw">
            <span class="pdf-choice-preview bw" aria-hidden="true">PDF</span>
            <strong>Noir et blanc</strong>
          </button>
        </div>
        <button class="button pdf-choice-cancel dialog-close" type="button" data-pdf-color-cancel>Annuler</button>
      </section>`;

    backdrop.addEventListener("click", event => {
      const modeButton = event.target.closest?.("[data-pdf-color-mode]");
      if (modeButton) {
        continueExport(modeButton.dataset.pdfColorMode);
        return;
      }
      if (event.target.closest?.("[data-pdf-color-cancel]") || event.target === backdrop) closeChoice();
    });

    document.body.append(backdrop);
    backdrop.querySelector('[data-pdf-color-mode="color"]')?.focus({ preventScroll: true });
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.('[data-action="export-pickup-pdf"]');
    if (!button) return;

    if (button.dataset.pdfChoiceApproved === "1") {
      delete button.dataset.pdfChoiceApproved;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    openChoice(button);
  }, true);

  window.fetch = function patchedFetch(input, init = {}) {
    try {
      const url = new URL(requestUrl(input), window.location.origin);
      if (url.pathname !== "/api/report-pdf" || requestMethod(input, init) !== "POST" || typeof init.body !== "string") {
        return originalFetch(input, init);
      }

      const payload = JSON.parse(init.body);
      const colorMode = nextColorMode === "bw" ? "bw" : "color";
      nextColorMode = "color";
      const nextInit = {
        ...init,
        body: JSON.stringify({ ...payload, ...browserClock(), colorMode })
      };
      return originalFetch(input, nextInit);
    } catch {
      return originalFetch(input, init);
    }
  };
})();
