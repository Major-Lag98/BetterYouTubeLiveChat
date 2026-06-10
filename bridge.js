/*
 * Better YouTube Live Chat — storage bridge (ISOLATED world).
 *
 * The blocker runs in the page's MAIN world, where chrome.storage is NOT
 * available. This bridge runs in the ISOLATED world (which has chrome.*),
 * reads the `enabled` flag, and relays it — plus any later changes — to the
 * MAIN world via window.postMessage (both worlds share the same window).
 */
(() => {
    "use strict";

    const post = (enabled) =>
        window.postMessage({ __bytlc: "state", enabled: !!enabled }, location.origin);

    const sendCurrent = () =>
        chrome.storage.local.get("enabled", (d) => post(d.enabled ?? false));

    // Initial push (MAIN may not be listening yet — see requestState handshake).
    sendCurrent();

    // Relay future toggles from the popup.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.enabled) post(changes.enabled.newValue);
    });

    // MAIN asks for the current state once it's ready.
    window.addEventListener("message", (e) => {
        if (e.source !== window || e.origin !== location.origin) return;
        if (e.data && e.data.__bytlc === "requestState") sendCurrent();
    });
})();
