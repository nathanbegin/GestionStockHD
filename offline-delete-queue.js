(() => {
  const STORAGE_KEY = "restock_app_v1";
  const PENDING_DELETE_KEY = "restock_pending_delete_v1";
  const PENDING_STATUS_KEY = "restock_pending_status_v1";
  const VALID_KINDS = new Set(["pickup", "list", "department"]);
  const nativeFetch = window.fetch.bind(window);
  let retryTimer = null;
  let indicatorObserver = null;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadQueue() {
    const queue = readJson(PENDING_DELETE_KEY, []);
    return Array.isArray(queue)
      ? queue.filter(entry => entry?.id && entry?.targetId && VALID_KINDS.has(entry.kind))
      : [];
  }

  function saveQueue(queue) {
    localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(queue));
    refreshIndicator();
  }

  function queueDeletion(kind, targetId, history = null) {
    if (!VALID_KINDS.has(kind) || !targetId) return;
    const queue = loadQueue();
    const existing = queue.find(entry => entry.kind === kind && entry.targetId === targetId);
    if (existing) {
      if (!existing.history && history) existing.history = history;
      saveQueue(queue);
      return;
    }
    queue.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind,
      targetId,
      history: history ? { ...history } : null,
      createdAt: new Date().toISOString()
    });
    saveQueue(queue);
  }

  function addUnique(array, value) {
    return [...new Set([...(Array.isArray(array) ? array : []), value])];
  }

  function applyDeletion(snapshot, entry) {
    if (!snapshot || !entry?.targetId) return snapshot;
    if (entry.kind === "pickup") {
      snapshot.pickupLists = (snapshot.pickupLists || []).filter(item => item?.id !== entry.targetId);
      snapshot.deletedPickupListIds = addUnique(snapshot.deletedPickupListIds, entry.targetId);
    } else if (entry.kind === "list") {
      snapshot.lists = (snapshot.lists || []).filter(item => item?.id !== entry.targetId);
      snapshot.deletedListIds = addUnique(snapshot.deletedListIds, entry.targetId);
    } else if (entry.kind === "department") {
      snapshot.departments = (snapshot.departments || []).filter(item => item?.id !== entry.targetId);
      snapshot.deletedDepartmentIds = addUnique(snapshot.deletedDepartmentIds, entry.targetId);
    }
    if (entry.history?.id) {
      snapshot.history = Array.isArray(snapshot.history) ? snapshot.history : [];
      if (!snapshot.history.some(event => event?.id === entry.history.id)) snapshot.history.unshift({ ...entry.history });
    }
    return snapshot;
  }

  function hasTombstone(snapshot, entry) {
    if (!snapshot || !entry) return false;
    const key = entry.kind === "pickup"
      ? "deletedPickupListIds"
      : entry.kind === "list"
        ? "deletedListIds"
        : "deletedDepartmentIds";
    return Array.isArray(snapshot[key]) && snapshot[key].includes(entry.targetId);
  }

  function removeAcknowledged(ids) {
    if (!ids?.size) return;
    saveQueue(loadQueue().filter(entry => !ids.has(entry.id)));
  }

  function currentPendingCount() {
    const statuses = readJson(PENDING_STATUS_KEY, []);
    return loadQueue().length + (Array.isArray(statuses) ? statuses.length : 0);
  }

  function refreshIndicator() {
    const label = document.querySelector("#syncLabel");
    if (!label) return;
    const total = currentPendingCount();
    if (!total) {
      if (label.dataset.offlineDeleteQueue === "1") {
        label.dataset.offlineDeleteQueue = "0";
        setTimeout(() => {
          if (currentPendingCount() || label.dataset.offlineDeleteQueue === "1") return;
          if (/à envoyer|en attente/i.test(label.textContent || "")) label.textContent = navigator.onLine ? "Cloud" : "Hors ligne";
        }, 50);
      }
      return;
    }
    const desired = navigator.onLine ? `${total} à envoyer` : `Hors ligne · ${total} en attente`;
    label.dataset.offlineDeleteQueue = "1";
    if (label.textContent !== desired) label.textContent = desired;
  }

  function observeIndicator() {
    const label = document.querySelector("#syncLabel");
    if (!label || indicatorObserver) return;
    indicatorObserver = new MutationObserver(() => {
      if (currentPendingCount()) queueMicrotask(refreshIndicator);
    });
    indicatorObserver.observe(label, { childList: true, characterData: true, subtree: true });
    refreshIndicator();
  }

  function scheduleRetry(delay = 5000) {
    clearTimeout(retryTimer);
    if (!navigator.onLine || !loadQueue().length) return;
    retryTimer = setTimeout(() => {
      if (!navigator.onLine || !loadQueue().length) return;
      document.querySelector("#syncButton")?.click();
    }, delay);
  }

  function syncPath(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input || "");
      return new URL(raw, location.href).pathname;
    } catch {
      return "";
    }
  }

  window.fetch = async (input, init = {}) => {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    const isSync = method === "POST" && syncPath(input) === "/api/sync" && typeof init?.body === "string";
    if (!isSync) return nativeFetch(input, init);

    const sentQueue = loadQueue();
    if (!sentQueue.length) return nativeFetch(input, init);

    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      return nativeFetch(input, init);
    }
    if (!body?.snapshot) return nativeFetch(input, init);

    sentQueue.forEach(entry => applyDeletion(body.snapshot, entry));
    const requestInit = { ...init, body: JSON.stringify(body) };

    try {
      const response = await nativeFetch(input, requestInit);
      if (!response.ok) {
        scheduleRetry();
        return response;
      }

      let payload;
      try {
        payload = await response.clone().json();
      } catch {
        scheduleRetry();
        return response;
      }
      if (!payload?.snapshot) {
        scheduleRetry();
        return response;
      }

      const acknowledged = new Set(sentQueue.filter(entry => hasTombstone(payload.snapshot, entry)).map(entry => entry.id));
      removeAcknowledged(acknowledged);

      const stillPending = loadQueue();
      stillPending.forEach(entry => applyDeletion(payload.snapshot, entry));
      refreshIndicator();
      if (stillPending.length) scheduleRetry(5000);

      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      scheduleRetry();
      throw error;
    }
  };

  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const targetId = String(button.dataset.id || "");
    if (!targetId || !["delete-pickup", "delete-list", "delete-department"].includes(action)) return;

    setTimeout(() => {
      const snapshot = readJson(STORAGE_KEY, null);
      if (!snapshot) return;
      if (action === "delete-pickup" && (snapshot.deletedPickupListIds || []).includes(targetId)) {
        const history = (snapshot.history || []).find(entry => entry?.type === "pickup_deleted" && entry?.pickupListId === targetId) || null;
        queueDeletion("pickup", targetId, history);
      } else if (action === "delete-list" && (snapshot.deletedListIds || []).includes(targetId)) {
        queueDeletion("list", targetId);
      } else if (action === "delete-department" && (snapshot.deletedDepartmentIds || []).includes(targetId)) {
        queueDeletion("department", targetId);
      }
      scheduleRetry(6500);
    }, 0);
  });

  window.addEventListener("online", () => {
    refreshIndicator();
    scheduleRetry(1000);
  });
  window.addEventListener("offline", refreshIndicator);
  window.addEventListener("storage", event => {
    if ([PENDING_DELETE_KEY, PENDING_STATUS_KEY].includes(event.key)) refreshIndicator();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observeIndicator, { once: true });
  else observeIndicator();
})();
