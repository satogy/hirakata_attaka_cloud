# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**ひらかたあったかクラウド (Hirakata Attaka Cloud)** — a small community mutual-aid marketplace board. Residents post things they need help with ("困っています") or things they can offer ("私にできること") across three categories: ヒト (人手/people), モノ (物資/goods), コト (作業/tasks). The app auto-suggests matches between opposite-mode listings in the same category, and a "coordinator" (admin) screen lets a human manually connect people, view stats, and export CSVs.

This is a renamed/rebranded continuation of an earlier pilot called `monomatch-pilot` (see README.md) — the Firebase project is still named `monomatch-pilot` and the GitHub Pages URL may still reflect that name.

## Stack and running the app

Plain static site, **no build step, no bundler, no package.json, no test suite**:
- `index.html` — minimal shell, loads `style.css` and `app.js` as an ES module
- `app.js` — entire application (state, rendering, Firebase calls) in one file
- `style.css` — all styling
- `firebase-config.js` — Firebase project config + optional `ACCESS_CODE` gate string (not secret — this is a client-side Firebase web config)
- `firestore.rules` — Firestore security rules (deployed manually via Firebase Console, not via CLI/CI)

Firebase SDK (`firebase-app`, `firebase-auth`, `firebase-firestore` v10.12.2) is imported directly from the `gstatic.com` CDN inside `app.js` — there is nothing to `npm install`.

To develop/preview: just serve the directory statically (e.g. `npx serve .` or open `index.html` via a local server — `file://` won't work well with ES modules/Firebase). To deploy: commit and push to `main`; GitHub Pages rebuilds automatically after a few minutes.

There are no lint/test/build commands to run — verify changes by loading the page in a browser against the live Firebase project.

## Architecture

**Single-file vanilla JS app, no framework.** `app.js` holds one global `state` object and a `render()` function that wipes and rebuilds `#root`'s `innerHTML` from scratch on every state change (no virtual DOM, no diffing). Sub-renderers (`renderTop`, `renderRegister`, `renderConnections`, `renderChatTab`, `renderAdmin`, etc.) each return a DOM element for the active tab; `render()` assembles header + tabs + the active panel. Realtime data (`listings`, `connections`, per-thread chat `messages`) is streamed in via Firestore `onSnapshot` listeners that mutate `state` and call `render()` again.

**Identity model is deliberately split from Firebase Auth.** Every user signs in anonymously via Firebase Auth, but the app's actual identity is a separate `profiles/{profileId}` document keyed by a random ID generated client-side (`uid()`). That ID — the "マイページコード" (My Page Code) — is shown to the user on first signup and stored in `localStorage`. Re-entering the code (`onGateRestore`) lets someone recover the same profile from a different browser/device or after clearing site data, independent of the Firebase Auth session. This is intentionally a shared-secret scheme, not real authentication — anyone who has the code can impersonate that profile. `firestore.rules` only checks `request.auth != null` (any signed-in-anonymously user), not code ownership, so all real access control is client-side convention. This tradeoff is documented in README.md and is considered acceptable only for a small trusted pilot group (optionally gated further by the app-wide `ACCESS_CODE` in `firebase-config.js`).

**Firestore data model:**
- `profiles/{profileId}` — `{ id, name, lat, lng, createdAt }`
- `listings/{listingId}` — a need or offer: `{ id, userId, userName, mode: 'need'|'offer', kind: 'ヒト'|'モノ'|'コト', subcat, title, note, deadline, lat, lng, status: 'open'|..., createdAt }`
- `connections/{connId}` — a proposed/confirmed pairing between a need listing and an offer listing (renamed from `matches` in the previous `monomatch-pilot` version): `{ id, needId, offerId, title, kind, participants, distanceKm, status: 'proposed'|'connected', connectedBy: 'system'|'coordinator'|<profileId>, connectedByName, connectedAt, matchedAt, createdAt }` — `connectedByName` is the display name of whoever proposed the connection (null for `'system'` auto-suggestions), used in the coordinator screen's audit trail. `matchedAt` is set only when a participant clicks 「つながり成立にする」 (status flips to `'connected'`); older records predating this field will be missing it.
  - `connections/{connId}/messages/{messageId}` — chat subcollection: `{ senderId, senderName, text, ts }`
- `admins/{authUid}` — presence of a doc keyed by the Firebase Auth anonymous UID marks that browser session as an admin: `{ claim, profileName, registeredAt }`. See "Admin role" below.

**Matching logic:** `autoSuggestConnections()` runs after every new listing is created and proposes a `connection` for every existing opposite-mode listing with the same `kind` + `subcat` (`proposeConnection`, dedup'd by need/offer pair). Distance between the two parties is computed client-side via `haversine()` using each profile's stored `lat`/`lng`. The coordinator screen (`renderAdmin`) additionally allows manually pairing any open need with any open offer (`connectedBy: 'coordinator'`), and surfaces aggregate stats, a per-category bar chart, and CSV export of listings/connections (`exportCsv`).

**Admin role.** Separate from — and stricter than — the regular マイページコード identity model, because it gates something genuinely sensitive (reading other people's chat threads). Since `profileId` is unverifiable by Firestore rules, admin status is instead tied to the Firebase Auth anonymous UID (`request.auth.uid`), via a self-service one-time registration: entering the correct passphrase (hardcoded in `firestore.rules`, never shipped to any client — unlike `ACCESS_CODE`) in the コーディネーター screen calls `setDoc(doc(db,'admins', auth.currentUser.uid), {claim, ...})`; the rule only allows the write through if `claim` matches. Once written, that browser/device's current Firebase Auth session is admin for good (`checkAdminStatus()` checks on every boot); clearing site data or switching devices gets a new anonymous UID and requires re-entering the passphrase. Admin-only UI (gated by `state.isAdmin`, checked again in `firestore.rules` for the `admins` collection itself but *not* for `connections/*/messages` — see caveat below): a per-connection chat viewer (`listenAdminChat` / `renderAdminChatViewer`) and a report (`generateReport`) showing average/per-row "registered → matched" and "first chat message → matched" durations. Caveat: `connections/{connId}/messages` reads are *not* restricted to admins/participants at the Firestore rules level (same `request.auth != null` as everything else) — real per-participant enforcement isn't achievable without linking `profileId` to `authUid` at signup, which hasn't been done. The admin gate only stops a casual user from finding this feature in the UI, not a technically determined one from reading Firestore directly.

**Tabs:** TOP (deadline-sorted feed of open needs) → 登録する/register (create a listing; also lists the current user's own listings) → つながり/connections (this user's proposed/confirmed connections) → チャット/chat (per-connection realtime thread) → コーディネーター/admin (global view + manual matching + stats + CSV export; admin-only report + chat viewer for whoever has completed admin registration).
