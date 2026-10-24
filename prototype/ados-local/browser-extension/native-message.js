(() => {
  "use strict";

  const timeouts = Object.freeze({
    status: 15_000,
    "restore-ready-card": 120_000,
    "prepare-confirm": 15_000,
    confirm: 15_000,
    compile: 360_000,
    dispatch: 360_000,
    resume: 360_000,
  });

  function timeoutFor(kind) {
    const timeoutMs = timeouts[kind];
    if (!Number.isInteger(timeoutMs)) {
      throw new Error("BLOCKED_NATIVE_HOST:REQUEST_KIND");
    }
    return timeoutMs;
  }

  function send(runtime, host, message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("BLOCKED_NATIVE_HOST:CALLBACK_TIMEOUT"));
      }, timeoutFor(message?.kind));

      const settle = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };

      try {
        runtime.sendNativeMessage(host, message, (response) => {
          const chromeError = runtime.lastError;
          settle(() => {
            if (chromeError) {
              reject(new Error("BLOCKED_NATIVE_HOST:UNAVAILABLE"));
            } else if (response?.ok !== true) {
              reject(new Error(response?.error ?? "BLOCKED_NATIVE_HOST:REJECTED"));
            } else {
              resolve(response.result);
            }
          });
        });
      } catch {
        settle(() => reject(new Error("BLOCKED_NATIVE_HOST:UNAVAILABLE")));
      }
    });
  }

  globalThis.ADOS_NATIVE_MESSAGE = Object.freeze({ send, timeoutFor, timeouts });
})();
