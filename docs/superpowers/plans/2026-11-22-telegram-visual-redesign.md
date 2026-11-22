# TauriTavern Telegram Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the rough mobile shell with Telegram classic light and Night visual systems across chat, navigation, character, history and settings views.

**Architecture:** Keep the existing shell state machine and native data panels. Enrich the shell DOM with a real drawer hierarchy and apply one token-driven CSS surface that owns mobile layout, bubbles, composer, drawers and native panel presentation.

**Tech Stack:** Existing HTML, vanilla ES modules, Font Awesome 6, CSS custom properties, Tauri mobile host.

**Spec:** `docs/superpowers/specs/2026-11-22-telegram-visual-redesign-design.md`

## Global Constraints

- Do not copy or mutate character cards, lorebooks, chats, API credentials or formal backups.
- Preserve native panel ownership of data and existing navigation contracts.
- Keep Android safe-area handling and minimum 48px touch targets.
- Avoid network font or image dependencies; use existing vector icons and CSS surfaces.

## Review Focus

- Drawer navigation must be inert while closed and restore focus when dismissed.
- A chat with no character must keep a usable avatar, title and composer state.
- Native roles/history/more panels must remain reachable and return to the same shell route.
- Long messages, large text, landscape and reduced motion must not produce horizontal overflow.

### Task 1: Enrich the shell navigation DOM

**Files:**
- Modify: `src/scripts/mobile-chat-shell.js`
- Test: `tests/mobile-chat-shell.test.mjs`

- [x] Add profile, grouped routes, current-chat preview and persistent local theme choice to the drawer.
- [x] Keep existing route and panel identifiers stable.
- [x] Preserve accessible names, Escape/back dismissal and data ownership.
- [x] Run the focused shell tests.

### Task 2: Replace mobile visual surfaces

**Files:**
- Modify: `src/css/mobile-chat-shell.css`
- Modify: `src/index.html` only if a required style hook is missing.

- [x] Define classic light and Night semantic tokens; replace conflicting CSS in one pass.
- [x] Style header, drawer, route states, bubbles, composer, roles, history and more sections.
- [x] Preserve existing native drawer sizing and safe-area variables.
- [x] Check 375px portrait, landscape, large text and reduced motion in the preview.

### Task 3: Verify and package

**Files:**
- Modify: `.local/mobile-chat-rework/delivery.md`
- Create/refresh: `output/playwright/telegram-visual-final.png`, `output/playwright/telegram-visual-drawer-final.png`

- [x] Run focused shell and browser tests with the repository's VM module flag.
- [x] Run frontend guardrails and web build.
- [x] Rebuild and sign the personal APK when the visual build is verified.
- [x] Record the new APK hash and any environment-only check limitation.

## Validation notes

- 7 navigation tests, 79 browser tests, 190 UI tests passed. Contracts: 438 of 439 passed; the existing macOS Icon Composer test requires unavailable Xcode actool. Rust tests/clippy remain unexecuted because the full check pipeline stops there.
- Independent review findings addressed: preserve native action visibility; trap drawer focus; use a viewport-sized action sheet for short messages; preserve the native wallpaper behind the chat tint.
- Actual browser checks covered 375×812, 812×375, 1280×850, font scale 1.6, reduced motion, 375×450 input viewport, message edit/cancel, short-message actions, day/night and wallpaper rendering.
- Build and signing verified for com.tauritavern.personal. All repository changes remain uncommitted on feature/mobile-chat-shell.

## Detail polish follow-up

- [x] Refine existing tokens, typography, bubble geometry, wallpaper, header and composer in `src/css/mobile-chat-shell.css`; shorten mobile placeholders at the existing owner in `src/scripts/RossAscends-mods.js` and `src/index.html`.
- [x] Refine native role filters, history metadata/actions and grouped settings; keep IDs, native events and saved data unchanged.
- [x] Verify actual page states at 375/390px, landscape, large font, input viewport and dark mode; run the existing behavioral checks and update signed personal APK and delivery record.

### Detail validation and review

- Browser checks passed at 390×844, 375×812, 812×375 and 375×450, plus 1.6× chat text and reduced motion. Verified chat, roles, settings, history and message actions; no horizontal overflow or clipped composer.
- Corrected inherited styles that centered the placeholder, faded enabled message actions, corrupted excluded Favorites labels and left a 26px role-footer gap. Night timestamp contrast against outgoing bubbles measures 4.65:1.
- Native welcome and drawer shortcuts now enter the same mobile `openPanel` path before the existing native layout procedure. Extended the existing complete-app browser test, observed its failure before the fix and its pass afterward.
- Fresh check: 79 browser tests passed, 438/439 contracts passed; the sole failure remains missing Xcode `actool`. UI tests 190/190 and focused navigation 7/7 passed. Web build passed; full Rust tests/clippy remain unexecuted after the environment failure.
- Final independent static review found no material issue after fixes. No commits or remote operations were authorized or performed.

- Final personal APK rebuilt and v2/v3 signature verified. SHA-256: f9b53b9535c1a5c0cbff4a39610bdbf4571d58c5b1b8417a71f2b146cee5ff21. Final screenshots, manifest and delivery record refreshed; task-owned scratch and intermediate screenshots cleaned.
