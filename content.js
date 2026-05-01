(() => {
    "use strict";

    console.log("Chat blocker content script loaded.");

    const STEP_DELAY_MS = 600;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let enabled = false;
    let observer = null;

    const queue = [];
    const seen = new WeakSet();
    let processing = false;

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
        queue.length = 0;
    }

    function attachObserver(chatItemsContainer) {
        observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type !== 'childList') continue;
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (!node.matches?.('yt-live-chat-text-message-renderer')) continue;
                    enqueueMessage(node);
                }
            }
        });
        observer.observe(chatItemsContainer, { childList: true, subtree: true });
        console.log("Observer attached to chat container.");
    }

    function enqueueMessage(node) {
        if (seen.has(node)) return;
        seen.add(node);
        logMessage(node);
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
                    await blockMessage(node);
                } catch (e) {
                    console.error('[BetterYTLiveChat] Error blocking message:', e);
                }
            }
        } finally {
            processing = false;
        }
    }

    async function waitFor(predicate, { timeout = 5000, interval = 100 } = {}) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const result = predicate();
            if (result) return result;
            await sleep(interval);
        }
        return null;
    }

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        const win = el.ownerDocument?.defaultView;
        if (!win) return false;
        const style = win.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findOpenDropdown(doc) {
        for (const dd of doc.querySelectorAll('tp-yt-iron-dropdown')) {
            if (isVisible(dd)) return dd;
        }
        return null;
    }

    function findMenuItemInOpenDropdown(doc, label) {
        const dropdown = findOpenDropdown(doc);
        if (!dropdown) return null;
        const re = new RegExp(`^${label}$`, 'i');
        const items = dropdown.querySelectorAll(
            'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, tp-yt-paper-item'
        );
        for (const it of items) {
            if (!isVisible(it)) continue;
            const text = it.textContent?.trim();
            if (text && re.test(text)) return it;
        }
        return null;
    }

    function findConfirmBlockButton(doc) {
        const dialogs = doc.querySelectorAll(
            'yt-confirm-dialog-renderer, tp-yt-paper-dialog'
        );
        for (const dialog of dialogs) {
            if (!isVisible(dialog)) continue;
            const buttons = dialog.querySelectorAll(
                'yt-button-renderer button, tp-yt-paper-button, button'
            );
            for (const b of buttons) {
                const text = b.textContent?.trim();
                if (text && /^block$/i.test(text)) return b;
            }
        }
        return null;
    }

    // Polymer's paper-item listens for tap (mousedown+mouseup) rather than raw click.
    // Dispatch the full sequence so the menu actually fires its on-tap handler.
    function syntheticClick(el) {
        const win = el.ownerDocument?.defaultView ?? window;
        const rect = el.getBoundingClientRect();
        const init = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: win,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            button: 0,
            buttons: 1,
        };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', init));
        el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
    }

    async function blockMessage(node) {
        const authorName = node.querySelector('#author-name')?.textContent?.trim() || '(unknown)';
        const doc = node.ownerDocument || document;

        // Step 1: Click the kebab (three-dots) menu button on this message
        const kebab = node.querySelector(
            '#menu #button, #menu button, yt-icon-button#button, #overflow-button button'
        );
        if (!kebab) {
            console.warn('[BetterYTLiveChat] Kebab button not found for', authorName);
            return;
        }
        // Hover the message — YouTube hides the kebab via CSS unless hovered.
        node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(50);
        syntheticClick(kebab);
        console.log('[BetterYTLiveChat] Clicked kebab for', authorName);

        // Step 2: Wait for the popup menu to actually be open, then click "Block"
        const blockItem = await waitFor(() => findMenuItemInOpenDropdown(doc, 'block'));
        if (!blockItem) {
            console.warn('[BetterYTLiveChat] Block menu item not found for', authorName);
            doc.body?.click();
            return;
        }
        console.log('[BetterYTLiveChat] Found Block menu item:', blockItem);
        await sleep(STEP_DELAY_MS);
        // The renderer wraps an <a class="yt-simple-endpoint">; YouTube's endpoint
        // handler listens on that anchor, so dispatch the click there.
        const blockTarget =
            blockItem.querySelector('a.yt-simple-endpoint') ||
            blockItem.querySelector('tp-yt-paper-item') ||
            blockItem;
        blockTarget.click();
        syntheticClick(blockTarget);
        console.log('[BetterYTLiveChat] Clicked Block menu item for', authorName);

        // Step 3: Wait for the confirmation dialog ("Block this person?"), then click "Block"
        const confirmBlock = await waitFor(() => {
            // The dialog is usually rendered in the iframe doc, but may live on the top-level doc.
            return findConfirmBlockButton(doc) || findConfirmBlockButton(document);
        });
        if (!confirmBlock) {
            console.warn('[BetterYTLiveChat] Confirm Block button not found for', authorName);
            return;
        }
        console.log('[BetterYTLiveChat] Found confirm Block button:', confirmBlock);
        await sleep(STEP_DELAY_MS);
        syntheticClick(confirmBlock);
        console.log('[BetterYTLiveChat] Blocked', authorName);
        await sleep(STEP_DELAY_MS);
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
