(() => {
    "use strict";

    console.log("Chat blocker content script loaded.");

    let enabled = false;
    let observer = null;

    chrome.storage.local.get("enabled", (data) => {
        enabled = data.enabled ?? false;
        if (enabled) startObserving();
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.enabled) {
            enabled = changes.enabled.newValue;
            if (enabled) {
                console.log("Enabling chat blocker...");
                startObserving();
            } else {
                console.log("Disabling chat blocker...");
                stopObserving();
            }
        }
    });

    function startObserving() {
        const chatIframe = document.querySelector('#chatframe');
        if (!chatIframe) {
            console.warn("Chat iframe not found yet, retrying...");
            setTimeout(startObserving, 1000);
            return;
        }

        const tryAttach = (attempts) => {
            const chatDoc = chatIframe.contentDocument;
            const chatItems = chatDoc?.querySelector("#items.yt-live-chat-item-list-renderer");
            if (chatItems) {
                console.log("Chat list container found, attaching observer.");
                attachObserver(chatItems);
            } else if (attempts < 20) {
                setTimeout(() => tryAttach(attempts + 1), 1000);
            } else {
                console.warn("Could not find chat items container after 20 attempts.");
            }
        };
        tryAttach(1);
    }

    function stopObserving() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    function attachObserver(chatItemsContainer) {
        observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type !== 'childList') continue;
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (!node.matches?.('yt-live-chat-text-message-renderer')) continue;
                    logMessage(node);
                }
            }
        });
        observer.observe(chatItemsContainer, { childList: true, subtree: true });
        console.log("Observer attached to chat container.");
    }

    function logMessage(node) {
        const authorName = node.querySelector('#author-name')?.textContent?.trim();
        const messageText = node.querySelector('#message')?.textContent?.trim();
        const authorId = node.getAttribute('author-external-channel-id') ?? null;
        const authorType = node.getAttribute('author-type') || 'viewer';
        const messageId = node.getAttribute('id') ?? null;
        const timestamp = node.querySelector('#timestamp')?.textContent?.trim() ?? null;

        console.log('[BetterYTLiveChat] New message:', {
            messageId,
            authorName,
            authorId,
            authorType,
            timestamp,
            messageText,
            node,
        });
    }
})();
