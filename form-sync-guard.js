(() => {
  const APP_MAIN_ID = "appMain";
  const PROTECTED_FORM_SELECTOR = "#itemForm, #scanForm";
  const SYNC_PATH = "/api/sync";
  let cloudRenderWindow = 0;
  let blockedReplacements = 0;

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url || "";
  }

  function requestMethod(input, init) {
    return String(init?.method || input?.method || "GET").toUpperCase();
  }

  function isSyncRequest(input, init) {
    try {
      const url = new URL(requestUrl(input), window.location.origin);
      return url.pathname === SYNC_PATH && requestMethod(input, init) === "POST";
    } catch {
      return false;
    }
  }

  function openCloudRenderWindow() {
    cloudRenderWindow += 1;
    window.setTimeout(() => {
      cloudRenderWindow = Math.max(0, cloudRenderWindow - 1);
    }, 0);
  }

  const previousFetch = window.fetch.bind(window);
  window.fetch = async function guardedFetch(input, init = {}) {
    const response = await previousFetch(input, init);
    if (!isSyncRequest(input, init)) return response;

    const originalText = response.text.bind(response);
    response.text = async function guardedResponseText() {
      const body = await originalText();
      openCloudRenderWindow();
      return body;
    };
    return response;
  };

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  if (!descriptor?.get || !descriptor?.set || descriptor.configurable === false) return;

  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value) {
      const isAppMain = this instanceof HTMLElement && this.id === APP_MAIN_ID;
      const activeForm = isAppMain
        ? this.querySelector(PROTECTED_FORM_SELECTOR)
        : null;

      if (isAppMain && activeForm && cloudRenderWindow > 0) {
        blockedReplacements += 1;
        this.dataset.deferredCloudRenders = String(blockedReplacements);
        window.dispatchEvent(new CustomEvent("restock:cloud-render-deferred", {
          detail: { count: blockedReplacements }
        }));
        return;
      }

      blockedReplacements = isAppMain ? 0 : blockedReplacements;
      if (isAppMain) delete this.dataset.deferredCloudRenders;
      descriptor.set.call(this, value);
    }
  });
})();
