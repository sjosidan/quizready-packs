# QuizReady Packs

The website and curated study-pack catalog for QuizReady. The app source and
private study vault live elsewhere; this repository contains only the website
and packs explicitly approved for redistribution. It is currently private.

## Run

```sh
npm ci
npm run dev
```

## Build

```sh
npm run build
```

The production site is written to `dist`. Relative asset URLs support both a
domain root and project subpaths. GitHub Pages can be enabled later if public
hosting is wanted.

## Pack Studio

- Imports legacy SQLite Anki `.apkg` files, Anki text exports, CSV, TSV, and
  existing `.quizpack` files.
- Converts basic, cloze, and template-generated cards with embedded images and
  pronunciation audio. Scheduling, video, LaTeX, and notetype-specific
  interactive layouts are not preserved.
- Creates manual cards and an optional study chapter.
- Saves My packs in browser local storage and downloads validated `.quizpack` JSON.
- Does not upload deck contents to a server.

Modern compressed Anki collections that cannot be read should be exported from
Anki as text. Review card content and redistribution rights before publishing.

## Publish a curated pack

Use the app repository's `tools/publish_pack.py` command, or add the validated
`.quizpack` to `public/packs/` and update `public/catalog.json` with its metadata,
size, and SHA-256. Public multi-user uploads need a separate authenticated,
moderated backend.
