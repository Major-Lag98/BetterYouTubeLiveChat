/*
 * Better YouTube Live Chat — detection + orchestration (MAIN world).
 *
 * Runs inside the `/live_chat` iframe's MAIN world. Watches incoming chat
 * messages, matches them against the banned-words list, and blocks offending
 * authors via the API core (window.BetterYTBlocker) — no DOM clicking.
 *
 * The `enabled` flag is delivered from the ISOLATED-world bridge (bridge.js)
 * over window.postMessage, since chrome.storage is unavailable in MAIN world.
 */
(() => {
    "use strict";

    // Only activate inside the live-chat iframe. The same content scripts are
    // injected into the top youtube.com page too (all_frames), where there is
    // no chat to watch.
    if (!location.pathname.startsWith("/live_chat")) return;

    console.log("[BetterYTLiveChat] Content script loaded (MAIN world, live_chat frame).");

    const BLOCK_THROTTLE_MS = 300; // small gap between blocks; the API is fast
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let enabled = false;
    let observer = null;

    const queue = [];
    const seen = new WeakSet();
    const blockedAuthorIds = new Set();
    let processing = false;

    // Build a single combined regex from the banned-words list. Whole-word,
    // case-insensitive. Returns null when the list is empty.
    const bannedRegex = (() => {
        const list = (window.__BETTER_YT_BANNED_WORDS ?? [])
            .map((w) => String(w).trim())
            .filter(Boolean);
        if (list.length === 0) {
            console.warn("[BetterYTLiveChat] No banned words configured — nobody will be blocked.");
            return null;
        }
        const escaped = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        console.log(`[BetterYTLiveChat] Loaded ${list.length} banned word(s)/phrase(s).`);
        return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
    })();

    function messageMatchesBannedWord(node) {
        if (!bannedRegex) return null;
        const text = node.querySelector("#message")?.textContent ?? "";
        const match = text.match(bannedRegex);
        return match ? match[0] : null;
    }

    // --- enabled flag, relayed from the ISOLATED bridge ------------------

    window.addEventListener("message", (e) => {
        if (e.source !== window || e.origin !== location.origin) return;
        const d = e.data;
        if (!d || d.__bytlc !== "state") return;
        const next = !!d.enabled;
        if (next === enabled) return;
        enabled = next;
        if (enabled) {
            console.log("[BetterYTLiveChat] Enabling chat blocker...");
            startObserving();
        } else {
            console.log("[BetterYTLiveChat] Disabling chat blocker...");
            stopObserving();
        }
    });
    // Ask the bridge for the current state (it may have posted before we were ready).
    window.postMessage({ __bytlc: "requestState" }, location.origin);

    // --- observe the chat ------------------------------------------------

    function startObserving() {
        if (observer) return;
        const tryAttach = (attempts) => {
            if (!enabled) return;
            const chatItems = document.querySelector("#items.yt-live-chat-item-list-renderer");
            if (chatItems) {
                attachObserver(chatItems);
            } else if (attempts < 20) {
                setTimeout(() => tryAttach(attempts + 1), 1000);
            } else {
                console.warn("[BetterYTLiveChat] Could not find chat items container after 20 attempts.");
            }
        };
        tryAttach(1);
    }

    function stopObserving() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        queue.length = 0;
    }

    function attachObserver(chatItemsContainer) {
        observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type !== "childList") continue;
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (!node.matches?.("yt-live-chat-text-message-renderer")) continue;
                    enqueueMessage(node);
                }
            }
        });
        observer.observe(chatItemsContainer, { childList: true, subtree: true });
        console.log("[BetterYTLiveChat] Observer attached to chat container.");
    }

    function enqueueMessage(node) {
        if (seen.has(node)) return;
        seen.add(node);

        // Don't try to block channel owners or moderators.
        const authorType = node.getAttribute("author-type") || "viewer";
        if (authorType === "owner" || authorType === "moderator") return;

        // Skip authors we've already queued for blocking — avoids stacking up
        // duplicate block flows when a spammer posts multiple messages quickly.
        const authorId = node.getAttribute("author-external-channel-id");
        if (authorId && blockedAuthorIds.has(authorId)) return;

        const matched = messageMatchesBannedWord(node);
        if (!matched) return;

        const authorName = node.querySelector("#author-name")?.textContent?.trim() || "(unknown)";
        console.log(`[BetterYTLiveChat] Banned word "${matched}" matched — queueing block for ${authorName}.`);
        if (authorId) blockedAuthorIds.add(authorId);

        queue.push(node);
        drainQueue();
    }

    async function drainQueue() {
        if (processing) return;
        processing = true;
        try {
            while (enabled && queue.length > 0) {
                const node = queue.shift();
                if (!node.isConnected) continue;
                try {
                    await blockNode(node);
                } catch (e) {
                    console.error("[BetterYTLiveChat] Error blocking message:", e);
                }
                await sleep(BLOCK_THROTTLE_MS);
            }
        } finally {
            processing = false;
        }
    }

    // --- block via the API core ------------------------------------------

    async function blockNode(node) {
        const authorName = node.querySelector("#author-name")?.textContent?.trim() || "(unknown)";
        const authorId = node.getAttribute("author-external-channel-id");

        const blocker = window.BetterYTBlocker;
        if (!blocker) {
            console.error("[BetterYTLiveChat] API blocker core not loaded.");
            return;
        }

        let result = await blocker.blockMessage(node);

        // The polymer data occasionally isn't populated the instant the node
        // appears; give it one quick retry before giving up.
        if (!result.ok && result.error === "no-menu-params" && node.isConnected) {
            await sleep(200);
            result = await blocker.blockMessage(node);
        }

        if (result.ok) {
            console.log(`[BetterYTLiveChat] Blocked ${authorName} (status ${result.status}).`);
        } else {
            console.warn(`[BetterYTLiveChat] Failed to block ${authorName}: ${result.error}.`, result);
            // Allow a future message from this author to retry the block.
            if (authorId) blockedAuthorIds.delete(authorId);
        }
    }
})();
