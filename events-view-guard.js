(() => {
  const CHECK_INTERVAL = 120;
  const LEAVE_GRACE_MS = 1200;
  let leaveRequestedUntil = 0;
  let editorDraft = null;
  let lastEditorForm = null;
  let reopeningEditor = false;
  let submittingEditor = false;
  let submittedAt = 0;

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

  function clearEditorDraft() {
    editorDraft = null;
    lastEditorForm = null;
    reopeningEditor = false;
    submittingEditor = false;
    submittedAt = 0;
  }

  function captureEditorDraft(form = document.querySelector("#eventEditorForm")) {
    if (!form) return null;
    const formData = new FormData(form);
    editorDraft = {
      eventId: String(form.dataset.eventId || ""),
      title: String(formData.get("title") || ""),
      date: String(formData.get("date") || ""),
      startTime: String(formData.get("startTime") || ""),
      endTime: String(formData.get("endTime") || ""),
      location: String(formData.get("location") || ""),
      description: String(formData.get("description") || ""),
      pickupListIds: formData.getAll("pickupListIds").map(String),
      participantIds: formData.getAll("participantIds").map(String),
      cancelled: Boolean(formData.get("cancelled"))
    };
    lastEditorForm = form;
    return editorDraft;
  }

  function setField(form, name, value) {
    const field = form.elements.namedItem(name);
    if (!field || typeof field.value === "undefined") return;
    if (field.value !== value) field.value = value;
  }

  function applyEditorDraft(form = document.querySelector("#eventEditorForm")) {
    if (!form || !editorDraft) return false;
    setField(form, "title", editorDraft.title);
    setField(form, "date", editorDraft.date);
    setField(form, "startTime", editorDraft.startTime);
    setField(form, "endTime", editorDraft.endTime);
    setField(form, "location", editorDraft.location);
    setField(form, "description", editorDraft.description);

    const pickupIds = new Set(editorDraft.pickupListIds || []);
    form.querySelectorAll('input[name="pickupListIds"]').forEach(input => {
      input.checked = pickupIds.has(String(input.value));
    });

    const participantIds = new Set(editorDraft.participantIds || []);
    form.querySelectorAll('input[name="participantIds"]').forEach(input => {
      input.checked = participantIds.has(String(input.value));
    });

    const cancelled = form.querySelector('input[name="cancelled"]');
    if (cancelled) cancelled.checked = Boolean(editorDraft.cancelled);
    lastEditorForm = form;
    return true;
  }

  function markLeavingEvents() {
    leaveRequestedUntil = Date.now() + LEAVE_GRACE_MS;
    clearEditorDraft();
    const eventsButton = document.querySelector("#eventsNavButton");
    eventsButton?.classList.remove("active");
    eventsButton?.removeAttribute("aria-current");
  }

  function restoreEventsView() {
    if (Date.now() < leaveRequestedUntil) return;
    if (!appVisible() || !eventsSelected() || eventsRendered()) return;
    document.querySelector("#eventsNavButton")?.click();
  }

  function successToastVisible() {
    const toast = document.querySelector("#toast.show");
    return Boolean(toast && /Événement (?:créé|modifié)/i.test(toast.textContent || ""));
  }

  function resumeEditor() {
    if (!editorDraft || Date.now() < leaveRequestedUntil || !eventsSelected()) return;

    if (submittingEditor && successToastVisible()) {
      clearEditorDraft();
      return;
    }

    const form = document.querySelector("#eventEditorForm");
    if (form) {
      if (form !== lastEditorForm) applyEditorDraft(form);
      if (submittingEditor) {
        const submitButton = form.querySelector('[type="submit"]');
        if (submitButton && !submitButton.disabled && Date.now() - submittedAt > 400) {
          submittingEditor = false;
          submittedAt = 0;
        }
      }
      return;
    }

    lastEditorForm = null;
    if (!eventsRendered()) return;

    if (submittingEditor) {
      const toast = document.querySelector("#toast.show");
      if (toast && !successToastVisible() && Date.now() - submittedAt > 650) {
        submittingEditor = false;
        submittedAt = 0;
      } else {
        return;
      }
    }

    if (reopeningEditor) return;
    reopeningEditor = true;
    const selector = editorDraft.eventId
      ? `[data-event-action="edit"][data-event-id="${CSS.escape(editorDraft.eventId)}"]`
      : '[data-event-action="new"]';
    const opener = document.querySelector(selector);
    if (!opener) {
      reopeningEditor = false;
      return;
    }

    opener.click();
    window.setTimeout(() => {
      applyEditorDraft();
      reopeningEditor = false;
    }, 30);
  }

  document.addEventListener("input", event => {
    if (event.target.closest("#eventEditorForm")) captureEditorDraft();
  }, true);

  document.addEventListener("change", event => {
    if (event.target.closest("#eventEditorForm")) captureEditorDraft();
  }, true);

  document.addEventListener("submit", event => {
    if (event.target.id !== "eventEditorForm") return;
    captureEditorDraft(event.target);
    submittingEditor = true;
    submittedAt = Date.now();
  }, true);

  document.addEventListener("click", event => {
    const standardNav = event.target.closest(".bottom-nav [data-nav]");
    if (standardNav) {
      markLeavingEvents();
      return;
    }

    if (event.target.closest("#eventsNavButton")) {
      leaveRequestedUntil = 0;
      return;
    }

    const action = event.target.closest("[data-event-action]");
    if (action?.dataset.eventAction === "close-editor") {
      clearEditorDraft();
      return;
    }

    if (["new", "edit"].includes(action?.dataset.eventAction || "")) {
      window.setTimeout(() => captureEditorDraft(), 30);
      return;
    }

    const backdrop = event.target.closest("[data-event-backdrop]");
    if (backdrop && event.target === backdrop) clearEditorDraft();
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    window.setInterval(() => {
      restoreEventsView();
      resumeEditor();
    }, CHECK_INTERVAL);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      restoreEventsView();
      window.setTimeout(resumeEditor, 50);
    });
  });
})();
