# YouTube Live Chat — Blocking a User: Network Findings

How the "Block" action in YouTube live chat works at the network level, and a
**verified working method to block any chat user without driving the DOM** (no
kebab menu, no confirm dialog).

Captured and verified live against `https://www.youtube.com/watch?v=mhJRzQsLZGg`
(Starbase Live) on 2026-06-10. 6 users were blocked end-to-end — 5 via the DOM
to reverse the flow, then **@Darth_Lawrence purely via API with zero DOM
interaction** — each verified as appearing in the account blocklist.

---

## TL;DR

Blocking a chat user is a **two-request flow**, both authenticated `POST`s to
YouTube's internal `youtubei` API (NOT to `myaccount.google.com` — that page
only *displays* the resulting blocklist):

1. **`POST /youtubei/v1/live_chat/get_item_context_menu?params=<msgParams>`**
   body `{context}` → returns the menu, including the **Block** item which
   carries the `moderate` token.
2. **`POST /youtubei/v1/live_chat/moderate?prettyPrint=false`**
   body `{context, params:<token>}` → actually blocks the user. `200` = blocked.

Both calls can be made directly with `fetch` from inside the chat frame using
plain **JSON** bodies — no DOM, no protobuf, no gzip. The two things that are
non-obvious and essential:

- **Auth header.** A bare `fetch` (cookies only) comes back `loggedOut:true`
  and the menu returns **no Block item**. You must add a `SAPISIDHASH`
  Authorization header.
- **Brand-account delegation.** The test account is a Brand Account, so the
  calls also need `X-Goog-PageId` / `X-Goog-AuthUser` headers and
  `context.user.onBehalfOfUser`. Without these the block acts as the wrong
  identity.

---

## The two endpoints

### 1. `get_item_context_menu` → returns the Block token

```
POST https://www.youtube.com/youtubei/v1/live_chat/get_item_context_menu
        ?params=<MSG_PARAMS>&prettyPrint=false
body: { context }
```

- `MSG_PARAMS` identifies the chat message/author. **It is read directly off
  the chat message element's data — no menu click needed:**

  ```js
  const d = el.__data?.data || el.data;   // see gotcha below — must try BOTH
  d?.contextMenuEndpoint?.liveChatItemContextMenuEndpoint?.params
  ```
  (`el` = a `yt-live-chat-text-message-renderer`.)

  > **Gotcha (cost two failed block attempts):** the polymer data is not always
  > on `el.__data.data`. Some message renderers expose it only on `el.data`
  > instead. If you read just `el.__data?.data`, the username will match but the
  > `params` lookup returns `undefined`, and the target looks "not visible in
  > chat" even though it is clearly there. **Always fall back:**
  > `const d = el.__data?.data || el.data;`. Reproduced live blocking
  > `@georgecartledge9056` — first two attempts returned "target not found"
  > using only `el.__data?.data`; adding the `|| el.data` fallback succeeded
  > immediately (`200 / ok:true`).

- The Block item is nested fairly deep. The `moderate` token lives at:

  ```
  liveChatItemContextMenuSupportedRenderers.menuRenderer.items[]
    → menuNavigationItemRenderer (text "Block")
      → navigationEndpoint.confirmDialogEndpoint.content.confirmDialogRenderer
        → confirmButton.buttonRenderer.serviceEndpoint
          → commandMetadata.webCommandMetadata.apiUrl   == "/youtubei/v1/live_chat/moderate"
          → moderateLiveChatEndpoint.params             == <TOKEN for step 2>
  ```

  Note Block is a `menuNavigationItemRenderer` (opens a confirm dialog), not a
  `menuServiceItemRenderer`. Report is the service item. That nesting is why a
  naive `items[].serviceEndpoint` scan finds nothing.

### 2. `moderate` → performs the block

```
POST https://www.youtube.com/youtubei/v1/live_chat/moderate?prettyPrint=false
body: { context, params: <TOKEN from step 1> }
```

A `200` with `responseContext.mainAppWebResponseContext.loggedOut === false`
and a populated `actions` array = success.

> Earlier note now corrected: when the page itself blocks via the UI, the
> `moderate` request body appears as **gzip-compressed protobuf** (raw bytes
> start with `1f 8b 08`). That is just the browser/page compressing its own
> request — it is **not required**. Sending a plain JSON `{context, params}`
> body works fine and is far simpler.

---

## Authentication (the part that makes it work)

YouTube innertube treats cookie-only requests as logged out for these
endpoints. You must send a `SAPISIDHASH` Authorization header.

```js
// SAPISIDHASH = ts + "_" + SHA1("<ts> <SAPISID> <origin>")
const origin = 'https://www.youtube.com';
const getCookie = n => (document.cookie.match(new RegExp('(^| )'+n+'=([^;]+)'))||[])[2] || null;
async function sha1hex(s){
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const ts = Math.floor(Date.now()/1000);
const mk = async c => c ? ts+'_'+await sha1hex(`${ts} ${c} ${origin}`) : null;

// YouTube sends three variants, one per cookie. SAPISIDHASH alone usually
// suffices, but sending all three matches the real client.
const authorization = [
  'SAPISIDHASH '  + await mk(getCookie('SAPISID')),
  getCookie('__Secure-1PAPISID') ? 'SAPISID1PHASH ' + await mk(getCookie('__Secure-1PAPISID')) : '',
  getCookie('__Secure-3PAPISID') ? 'SAPISID3PHASH ' + await mk(getCookie('__Secure-3PAPISID')) : '',
].filter(Boolean).join(' ');
```

`SAPISID` and the `__Secure-*PAPISID` cookies are readable from JS in the
youtube.com context (not HttpOnly) — that's by design, so the page can compute
this hash.

### Brand-account / delegated session

Pulled from `ytcfg`:

| ytcfg key             | value in test session                         | used as |
|-----------------------|-----------------------------------------------|---------|
| `DELEGATED_SESSION_ID`| `108413979431800020837`                       | `X-Goog-PageId` header **and** `context.user.onBehalfOfUser` |
| `SESSION_INDEX`       | `0`                                           | `X-Goog-AuthUser` header |
| `INNERTUBE_CONTEXT`   | object                                        | request `context` (clone, then set `onBehalfOfUser`) |
| `INNERTUBE_CONTEXT_CLIENT_VERSION` | `2.20260606.02.00`               | `X-Youtube-Client-Version` |

Headers sent on both calls:

```js
const headers = {
  'content-type': 'application/json',
  'authorization': authorization,
  'x-goog-authuser': '0',
  'x-goog-pageid': pageId,                 // DELEGATED_SESSION_ID
  'x-origin': origin,
  'x-youtube-client-name': '1',
  'x-youtube-client-version': clientVersion,
};
// fetch(..., { method:'POST', headers, credentials:'include', body })
```

For a **personal (non-brand) account**, omit `x-goog-pageid` and
`onBehalfOfUser`; `DELEGATED_SESSION_ID` will be absent.

---

## Full working method (verified, no DOM)

Runs inside the chat frame. Picks the most recent not-yet-blocked message,
resolves its Block token, and blocks. Returns the result.

```js
async function blockNextChatUser(alreadyBlocked = []) {
  const origin = 'https://www.youtube.com';
  const getCookie = n => (document.cookie.match(new RegExp('(^| )'+n+'=([^;]+)'))||[])[2] || null;
  const sha1hex = async s => {
    const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');
  };
  const ts = Math.floor(Date.now()/1000);
  const mk = async c => c ? ts+'_'+await sha1hex(`${ts} ${c} ${origin}`) : null;
  const authorization = [
    'SAPISIDHASH '  + await mk(getCookie('SAPISID')),
    getCookie('__Secure-1PAPISID') ? 'SAPISID1PHASH ' + await mk(getCookie('__Secure-1PAPISID')) : '',
    getCookie('__Secure-3PAPISID') ? 'SAPISID3PHASH ' + await mk(getCookie('__Secure-3PAPISID')) : '',
  ].filter(Boolean).join(' ');

  const cfg = window.ytcfg;
  const pageId = cfg.get('DELEGATED_SESSION_ID');            // null on personal accounts
  const context = JSON.parse(JSON.stringify(cfg.get('INNERTUBE_CONTEXT')));
  if (pageId) { context.user = context.user || {}; context.user.onBehalfOfUser = pageId; }

  const headers = {
    'content-type': 'application/json',
    'authorization': authorization,
    'x-goog-authuser': '0',
    'x-origin': origin,
    'x-youtube-client-name': '1',
    'x-youtube-client-version': cfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION'),
    ...(pageId ? { 'x-goog-pageid': pageId } : {}),
  };

  // 1. pick a target message + its context-menu params (straight off the DOM data, no click)
  let target = null;
  for (const el of [...document.querySelectorAll('yt-live-chat-text-message-renderer')].reverse()) {
    const d = el.__data?.data || el.data;   // must try both — see gotcha in endpoint #1
    const params = d?.contextMenuEndpoint?.liveChatItemContextMenuEndpoint?.params;
    const user = el.querySelector('#author-name')?.textContent?.trim();
    if (params && !alreadyBlocked.includes(user)) { target = { user, params }; break; }
  }
  if (!target) return { error: 'no unblocked target found' };

  // 2. get the context menu → extract the Block token
  const menu = await (await fetch(
    `${origin}/youtubei/v1/live_chat/get_item_context_menu?params=${encodeURIComponent(target.params)}&prettyPrint=false`,
    { method:'POST', headers, credentials:'include', body: JSON.stringify({ context }) }
  )).json();

  const items = menu?.liveChatItemContextMenuSupportedRenderers?.menuRenderer?.items || [];
  const block = items.find(it => (it.menuNavigationItemRenderer||it.menuServiceItemRenderer)
                  ?.text?.runs?.[0]?.text === 'Block');
  const svc = block?.menuNavigationItemRenderer?.navigationEndpoint
                  ?.confirmDialogEndpoint?.content?.confirmDialogRenderer
                  ?.confirmButton?.buttonRenderer?.serviceEndpoint;
  const apiUrl = svc?.commandMetadata?.webCommandMetadata?.apiUrl;       // /youtubei/v1/live_chat/moderate
  const params = svc?.moderateLiveChatEndpoint?.params;
  if (!params) return { error: 'no Block token (likely not authenticated)', target: target.user };

  // 3. moderate → block
  const res = await fetch(`${origin}${apiUrl}?prettyPrint=false`,
    { method:'POST', headers, credentials:'include', body: JSON.stringify({ context, params }) });
  const json = await res.json();
  return {
    blockedUser: target.user,
    status: res.status,
    loggedOut: json?.responseContext?.mainAppWebResponseContext?.loggedOut,
    actions: json?.actions?.length || 0,
    ok: res.status === 200 && !json?.error,
  };
}
```

Verified result against the live stream:

```json
{ "blockedUser": "@Darth_Lawrence", "status": 200, "loggedOut": false, "actions": 2, "ok": true }
```

…and `@Darth_Lawrence` then appeared in the account blocklist.

---

## Capturing this yourself (debugging note)

`playwright-cli`'s `requests` / trace tooling does **not** surface these calls
— they originate inside the cross-origin live-chat `<iframe>`
(`https://www.youtube.com/live_chat?...`), invisible to the top page's
CDP/network listeners.

What worked for the initial reverse-engineering: monkey-patch `window.fetch`
**inside the chat frame**, reading the body via `Request.clone().text()`
(YouTube calls `fetch` with a `Request` object, so `opts.body` is empty — you
must clone the Request):

```js
const chatFrame = page.frames().find(f => f.url().includes('live_chat'));
await chatFrame.evaluate(() => {
  window._captured = [];
  const orig = window.fetch;
  window.fetch = async (req, opts) => {
    const url = req instanceof Request ? req.url : String(req);
    const body = req instanceof Request ? await req.clone().text().catch(()=>null) : opts?.body;
    if (!url.includes('get_live_chat') && !url.includes('updated_metadata'))
      window._captured.push({ url, body });
    return orig(req, opts);
  };
});
```

---

## DOM flow (fallback / cross-reference)

Inside `#chatframe`:

1. Message rows are `yt-live-chat-text-message-renderer`; element `id` is the
   encoded message id; author is `#author-name`.
2. Hover row → click the **"Chat actions"** kebab: `<row-id> #menu-button #button`
   → fires `get_item_context_menu`.
3. Menu shows **Report** + **Block**. Block is an `<a>` with empty `href`
   (JS-driven); locate by text "Block".
4. Click Block → confirmation `<dialog>` "Block this person?" (Cancel / Block).
5. Click the dialog's **Block** → fires `moderate` → blocked.

---

## Users blocked during this session (all verified in blocklist)

- @cowboydanpaasch  (DOM)
- @maks_1_123       (DOM)
- @thatkevin8792    (DOM)
- @PsychoI3oy-wtf   (DOM)
- **@Darth_Lawrence (API only — no DOM)**
- **@georgecartledge9056 (API only — targeted by username; exposed the `el.data` gotcha above)**
- (@John-jr4dj was already blocked before the session)
