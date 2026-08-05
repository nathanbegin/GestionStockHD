(() => {
  const originalFetch = window.fetch.bind(window);

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

  window.fetch = function patchedFetch(input, init = {}) {
    try {
      const url = new URL(requestUrl(input), window.location.origin);
      if (url.pathname !== "/api/report-pdf" || requestMethod(input, init) !== "POST" || typeof init.body !== "string") {
        return originalFetch(input, init);
      }

      const payload = JSON.parse(init.body);
      const nextInit = {
        ...init,
        body: JSON.stringify({ ...payload, ...browserClock() })
      };
      return originalFetch(input, nextInit);
    } catch {
      return originalFetch(input, init);
    }
  };
})();
