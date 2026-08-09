(() => {
  const SEARCH_SELECTOR = "#filterSearch";
  const COMMIT_DELAY = 420;

  let commitTimer = null;
  let committing = false;
  let editing = false;
  let composing = false;
  let restoringFocus = false;
  let selectionStart = null;
  let selectionEnd = null;
  let lastValue = "";
  let blurTimer = null;

  function searchInput() {
    return document.querySelector(SEARCH_SELECTOR);
  }

  function rememberSelection(input) {
    lastValue = input?.value || "";
    selectionStart = Number.isInteger(input?.selectionStart) ? input.selectionStart : lastValue.length;
    selectionEnd = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : selectionStart;
  }

  function dispatchCommit(input) {
    if (!input?.isConnected) input = searchInput();
    if (!input) return;

    clearTimeout(commitTimer);
    commitTimer = null;
    input.value = lastValue;

    committing = true;
    const event = new Event("input", { bubbles: true });
    input.dispatchEvent(event);
    committing = false;
  }

  function scheduleCommit(input, delay = COMMIT_DELAY) {
    clearTimeout(commitTimer);
    commitTimer = window.setTimeout(() => dispatchCommit(input), delay);
  }

  function restoreSearchFocus() {
    if (!editing) return;
    const input = searchInput();
    if (!input) return;

    // Sauvegarder la sélection AVANT focus(). Sur mobile, focus() déclenche
    // synchronement focusin sur le nouvel input, dont la sélection initiale est 0.
    const desiredStart = selectionStart;
    const desiredEnd = selectionEnd;

    if (input.value !== lastValue) input.value = lastValue;
    if (document.activeElement !== input) {
      restoringFocus = true;
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      } finally {
        restoringFocus = false;
      }
    }

    try {
      const max = input.value.length;
      const start = Math.min(desiredStart ?? max, max);
      const end = Math.min(desiredEnd ?? start, max);
      input.setSelectionRange(start, end);
      selectionStart = start;
      selectionEnd = end;
    } catch {
      // Certains types d'input ne permettent pas setSelectionRange.
    }
  }

  function finishEditingIfReallyBlurred() {
    clearTimeout(blurTimer);
    blurTimer = window.setTimeout(() => {
      const input = searchInput();
      if (input && document.activeElement === input) return;
      editing = false;
    }, 140);
  }

  document.addEventListener("focusin", event => {
    const input = event.target?.closest?.(SEARCH_SELECTOR);
    if (!input) return;
    editing = true;
    clearTimeout(blurTimer);
    if (!restoringFocus) rememberSelection(input);
  }, true);

  document.addEventListener("focusout", event => {
    if (!event.target?.matches?.(SEARCH_SELECTOR)) return;
    finishEditingIfReallyBlurred();
  }, true);

  document.addEventListener("pointerdown", event => {
    if (!editing) return;
    if (event.target?.closest?.(SEARCH_SELECTOR)) return;
    editing = false;
  }, true);

  document.addEventListener("compositionstart", event => {
    if (event.target?.matches?.(SEARCH_SELECTOR)) composing = true;
  }, true);

  document.addEventListener("compositionend", event => {
    const input = event.target?.closest?.(SEARCH_SELECTOR);
    if (!input) return;
    composing = false;
    editing = true;
    rememberSelection(input);
    scheduleCommit(input);
  }, true);

  document.addEventListener("input", event => {
    const input = event.target?.closest?.(SEARCH_SELECTOR);
    if (!input || committing) return;

    // Empêche app.js de reconstruire #appMain à chaque caractère.
    // Une seule recherche est transmise après une courte pause de frappe.
    event.stopImmediatePropagation();
    editing = true;
    rememberSelection(input);
    if (!composing) scheduleCommit(input);
  }, true);

  document.addEventListener("keydown", event => {
    const input = event.target?.closest?.(SEARCH_SELECTOR);
    if (!input) return;
    if (event.key === "Enter") {
      rememberSelection(input);
      dispatchCommit(input);
    }
  }, true);

  // Quand l'utilisateur repositionne explicitement le curseur dans le champ,
  // mémoriser cette nouvelle position sans attendre le prochain caractère.
  document.addEventListener("keyup", event => {
    const input = event.target?.closest?.(SEARCH_SELECTOR);
    if (input && document.activeElement === input) rememberSelection(input);
  }, true);

  document.addEventListener("pointerup", event => {
    const input = event.target?.closest?.(SEARCH_SELECTOR);
    if (!input) return;
    queueMicrotask(() => {
      if (document.activeElement === input) rememberSelection(input);
    });
  }, true);

  const appMain = document.querySelector("#appMain");
  if (appMain) {
    new MutationObserver(() => {
      if (!editing) return;
      // MutationObserver s'exécute juste après render(), avant le prochain rendu visuel.
      // On rattache donc le focus et la sélection au nouvel input avant le rendu visuel.
      restoreSearchFocus();
    }).observe(appMain, { childList: true, subtree: true });
  }
})();
