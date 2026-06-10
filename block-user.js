/*
 * Better YouTube Live Chat — API block core (MAIN world).
 *
 * Blocks a chat user via YouTube's internal `youtubei` API with zero DOM
 * interaction (no kebab menu, no confirm dialog). Runs inside the `/live_chat`
 * iframe's MAIN world, where `window.ytcfg` and the polymer `__data` on each
 * message element are available.
 *
 * Two-call flow (both authenticated JSON POSTs):
 *   1. live_chat/get_item_context_menu?params=<msgParams>  -> returns Block token
 *   2. live_chat/moderate                                  -> performs the block
 *
 * See findings.md for the full reverse-engineering write-up.
 *
 * Exposes: window.BetterYTBlocker = { blockMessage, getMenuParams }
 */
(() => {
    "use strict";

    const ORIGIN = location.origin; // https://www.youtube.com

    // --- auth -------------------------------------------------------------

    async function sha1hex(s) {
        const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    function getCookie(name) {
        const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
        return m ? m[2] : null;
    }

    // YouTube authenticates these endpoints with a SAPISIDHASH header, not just
    // cookies. Without it the API responds logged-out and omits the Block item.
    async function buildAuthHeader() {
        const ts = Math.floor(Date.now() / 1000);
        const mk = async (c) => (c ? `${ts}_${await sha1hex(`${ts} ${c} ${ORIGIN}`)}` : null);
        const parts = [];
        const sapisid = getCookie("SAPISID");
        const p1 = getCookie("__Secure-1PAPISID");
        const p3 = getCookie("__Secure-3PAPISID");
        if (sapisid) parts.push("SAPISIDHASH " + (await mk(sapisid)));
        if (p1) parts.push("SAPISID1PHASH " + (await mk(p1)));
        if (p3) parts.push("SAPISID3PHASH " + (await mk(p3)));
        return parts.join(" ");
    }

    // --- innertube context / headers -------------------------------------

    function cfgGet(key) {
        try { return window.ytcfg?.get?.(key); } catch { return undefined; }
    }

    // Clones INNERTUBE_CONTEXT and, for Brand Accounts, sets the delegated
    // identity so the block is performed as the right channel.
    function buildContext() {
        const raw = cfgGet("INNERTUBE_CONTEXT");
        const ctx = raw ? JSON.parse(JSON.stringify(raw)) : null;
        const pageId = cfgGet("DELEGATED_SESSION_ID"); // null on personal accounts
        if (ctx && pageId) {
            ctx.user = ctx.user || {};
            ctx.user.onBehalfOfUser = pageId;
        }
        return { ctx, pageId };
    }

    async function buildHeaders(pageId) {
        const headers = {
            "content-type": "application/json",
            "authorization": await buildAuthHeader(),
            "x-goog-authuser": String(cfgGet("SESSION_INDEX") ?? "0"),
            "x-origin": ORIGIN,
            "x-youtube-client-name": "1",
            "x-youtube-client-version": cfgGet("INNERTUBE_CONTEXT_CLIENT_VERSION") || "",
        };
        if (pageId) headers["x-goog-pageid"] = pageId; // Brand Account delegation
        return headers;
    }

    // --- message -> block token ------------------------------------------

    // Read the context-menu params straight off the message element's polymer
    // data — no menu click. NOTE: the data lives on `__data.data` for some
    // renderers and `.data` for others; must try both (see findings.md gotcha).
    function getMenuParams(messageEl) {
        const d = messageEl?.__data?.data || messageEl?.data;
        return d?.contextMenuEndpoint?.liveChatItemContextMenuEndpoint?.params || null;
    }

    async function innertube(path, body, headers) {
        const sep = path.includes("?") ? "&" : "?";
        const res = await fetch(`${ORIGIN}${path}${sep}prettyPrint=false`, {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        return { res, json };
    }

    // Fetch the context menu and dig out the moderate (block) token. Block is a
    // menuNavigationItemRenderer whose confirm dialog's confirm button carries
    // the moderateLiveChatEndpoint — that's the token the moderate call needs.
    async function resolveBlockToken(menuParams, ctx, headers) {
        const { json } = await innertube(
            `/youtubei/v1/live_chat/get_item_context_menu?params=${encodeURIComponent(menuParams)}`,
            { context: ctx },
            headers,
        );
        const items = json?.liveChatItemContextMenuSupportedRenderers?.menuRenderer?.items || [];
        const block = items.find((it) => {
            const r = it.menuNavigationItemRenderer || it.menuServiceItemRenderer;
            return r?.text?.runs?.[0]?.text === "Block";
        });
        const svc = block?.menuNavigationItemRenderer?.navigationEndpoint
            ?.confirmDialogEndpoint?.content?.confirmDialogRenderer
            ?.confirmButton?.buttonRenderer?.serviceEndpoint;
        return {
            apiUrl: svc?.commandMetadata?.webCommandMetadata?.apiUrl || "/youtubei/v1/live_chat/moderate",
            params: svc?.moderateLiveChatEndpoint?.params || null,
            loggedOut: json?.responseContext?.mainAppWebResponseContext?.loggedOut,
        };
    }

    // --- public API -------------------------------------------------------

    // Block the author of the given chat message element.
    // Resolves to { ok, status, error?, actions?, loggedOut? }.
    async function blockMessage(messageEl) {
        const menuParams = getMenuParams(messageEl);
        if (!menuParams) return { ok: false, error: "no-menu-params" };

        const { ctx, pageId } = buildContext();
        if (!ctx) return { ok: false, error: "no-innertube-context" };

        const headers = await buildHeaders(pageId);
        const tok = await resolveBlockToken(menuParams, ctx, headers);
        if (!tok.params) {
            return { ok: false, error: tok.loggedOut ? "logged-out" : "no-block-token" };
        }

        const { res, json } = await innertube(tok.apiUrl, { context: ctx, params: tok.params }, headers);
        const ok = res.status === 200 && !json?.error;
        return {
            ok,
            status: res.status,
            actions: json?.actions?.length || 0,
            loggedOut: json?.responseContext?.mainAppWebResponseContext?.loggedOut,
            error: ok ? undefined : (json?.error ? "api-error" : "bad-status"),
        };
    }

    window.BetterYTBlocker = { blockMessage, getMenuParams };
    console.log("[BetterYTLiveChat] API blocker core loaded (MAIN world).");
})();
