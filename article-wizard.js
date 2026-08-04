(() => {
  const FORM_IDS = new Set(["itemForm", "scanForm"]);

  function directText(element) {
    return [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  function questionTitle(step, index) {
    const fieldTitle = step.querySelector(":scope > .field-title, :scope > span > .field-title");
    if (fieldTitle?.textContent.trim()) return fieldTitle.textContent.trim();

    if (step.matches("label")) {
      const text = directText(step);
      if (text) return text;
      const firstSpan = step.querySelector(":scope > span");
      if (firstSpan?.textContent.trim()) return firstSpan.textContent.trim();
    }

    const heading = step.querySelector("h2, h3, strong");
    return heading?.textContent.trim() || `Information ${index + 1}`;
  }

  function validateSku(input) {
    if (!input || input.name !== "sku") return true;
    const digits = String(input.value || "").replace(/\D/g, "");
    const valid = /^(?:1000|1001)\d{6}$/.test(digits);
    input.setCustomValidity(valid ? "" : "Le numéro doit contenir 10 chiffres et commencer par 1000 ou 1001.");
    return valid;
  }

  function validateStep(step) {
    const fields = [...step.querySelectorAll("input, select, textarea")]
      .filter(field => !field.disabled && field.type !== "hidden");

    for (const field of fields) {
      if (!validateSku(field) || !field.checkValidity()) {
        field.reportValidity();
        field.focus({ preventScroll: true });
        return false;
      }
    }
    return true;
  }

  function initializeWizard(form) {
    if (!FORM_IDS.has(form.id) || form.dataset.articleWizard === "ready") return;

    const grid = form.querySelector(":scope > .form-grid");
    const finalActions = form.querySelector(":scope > .form-actions");
    if (!grid || !finalActions) return;

    const steps = [...grid.children].filter(step => !step.matches('input[type="hidden"]'));
    if (steps.length < 2) return;

    form.dataset.articleWizard = "ready";
    form.classList.add("article-wizard");
    steps.forEach((step, index) => {
      step.classList.add("article-wizard-step");
      step.dataset.wizardStep = String(index);
    });
    finalActions.classList.add("article-wizard-final-actions");

    const header = document.createElement("div");
    header.className = "article-wizard-header";
    header.innerHTML = `
      <div class="article-wizard-heading">
        <span class="article-wizard-badge">Mode guidé activé</span>
        <span class="article-wizard-count" aria-live="polite"></span>
      </div>
      <h3 class="article-wizard-question"></h3>
      <div class="article-wizard-progress" aria-hidden="true"><span></span></div>
    `;
    grid.before(header);

    const controls = document.createElement("div");
    controls.className = "article-wizard-controls";
    controls.innerHTML = `
      <button class="button article-wizard-previous" type="button">← Précédent</button>
      <button class="button primary article-wizard-next" type="button">Suivant →</button>
    `;
    finalActions.before(controls);

    const previousButton = controls.querySelector(".article-wizard-previous");
    const nextButton = controls.querySelector(".article-wizard-next");
    const count = header.querySelector(".article-wizard-count");
    const question = header.querySelector(".article-wizard-question");
    const progress = header.querySelector(".article-wizard-progress span");
    let activeIndex = 0;

    function showStep(index, { focus = true } = {}) {
      activeIndex = Math.max(0, Math.min(index, steps.length - 1));
      steps.forEach((step, stepIndex) => {
        const active = stepIndex === activeIndex;
        step.hidden = !active;
        step.setAttribute("aria-hidden", active ? "false" : "true");
      });

      count.textContent = `Étape ${activeIndex + 1} sur ${steps.length}`;
      question.textContent = questionTitle(steps[activeIndex], activeIndex);
      progress.style.width = `${((activeIndex + 1) / steps.length) * 100}%`;
      previousButton.hidden = activeIndex === 0;
      nextButton.hidden = activeIndex === steps.length - 1;
      finalActions.hidden = activeIndex !== steps.length - 1;

      if (focus) {
        const field = steps[activeIndex].querySelector("input:not([type='hidden']):not([type='file']), select, textarea, button");
        field?.focus({ preventScroll: true });
        header.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    previousButton.addEventListener("click", () => showStep(activeIndex - 1));
    nextButton.addEventListener("click", () => {
      if (!validateStep(steps[activeIndex])) return;
      showStep(activeIndex + 1);
    });

    form.addEventListener("keydown", event => {
      if (event.key !== "Enter" || activeIndex >= steps.length - 1) return;
      if (event.target.matches("textarea, button, input[type='checkbox'], input[type='radio'], input[type='file']")) return;
      event.preventDefault();
      nextButton.click();
    });

    form.addEventListener("input", event => {
      if (event.target?.name === "sku") event.target.setCustomValidity("");
    });

    form.addEventListener("invalid", event => {
      const invalidStep = steps.findIndex(step => step.contains(event.target));
      if (invalidStep >= 0 && invalidStep !== activeIndex) showStep(invalidStep, { focus: false });
    }, true);

    showStep(0, { focus: false });
  }

  function initializeVisibleForms() {
    document.querySelectorAll("#itemForm, #scanForm").forEach(initializeWizard);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(initializeVisibleForms).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
    initializeVisibleForms();
  });
})();
