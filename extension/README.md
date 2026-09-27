# Glosano Importer

Browser extension for Chrome and Firefox that sends the current page to your Glosano server:

- **Article** — the main text is detected and framed on the page; adjust it with `+`/`−` (or `↑`/`↓`) and press `Enter`.
- **Blocks** — click paragraphs to pick them, then press `Enter`.
- **Selection** — imports the selected text.
- **YouTube** — on a video page, Glosano imports the video with its captions.

Lessons are always private. The page URL, author and site name are stored as the lesson source.

## Requirements

- A running Glosano server.
- You are signed in to Glosano **in the same browser**. The extension uses that session; it has no password or token of its own.

## Build

```bash
pnpm install
pnpm build           # .output/chrome-mv3
pnpm build:firefox   # .output/firefox-mv3
```

## Install (unpacked)

- **Chrome / Edge / Brave:** `chrome://extensions` → enable Developer mode → **Load unpacked** → `.output/chrome-mv3`.
- **Firefox (128+):** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `.output/firefox-mv3/manifest.json`. Temporary add-ons are removed when Firefox restarts.

## Set up

1. Open the extension settings (right-click the toolbar icon → Options / Manage extension → Preferences).
2. Enter your Glosano address, e.g. `https://glosano.example.com`, and click **Save and allow access**. The browser asks to allow access to that site only.
3. Sign in to Glosano in a normal tab if you are not signed in yet.

## Development

```bash
pnpm dev             # Chrome with hot reload
pnpm dev:firefox
pnpm test            # Vitest
pnpm typecheck && pnpm lint
```

UI strings live in `public/_locales/en/messages.json`; add a locale by adding `public/_locales/<lang>/messages.json`.

Third-party code: see `THIRD_PARTY_NOTICES.md`.
