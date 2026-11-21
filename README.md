# Paperlane — lightweight collaborative editor

React (Vite) + Express + SQLite (better-sqlite3). Single deployable service: Express serves the built frontend.

## Run locally (Node 18+)
```
npm install
npm run dev        # API :3001, UI :5173 (proxied)
npm test           # automated API test
npm run build && npm start   # production, http://localhost:3001
```
## Demo accounts (mocked auth — pick a user on the login screen)
alice@paperlane.test, bob@paperlane.test, carol@paperlane.test. To review sharing: as Alice create a doc → share with `bob@paperlane.test` → switch user to Bob → it appears under "Shared with me".

## Features
- Create, rename (title field), edit, autosave, reopen. Formatting: bold, italic, underline, H1/H2, bullet/numbered lists. Content is stored as sanitized HTML.
- Upload **.txt, .md, .docx** (≤2 MB) → becomes a new editable document. Markdown support is minimal (headings, bullets, paragraphs).
- Sharing: owner grants access by email; shared users can edit but cannot re-share. Docs are split into "My documents" / "Shared with me".
- Validation: empty titles rejected, HTML sanitized server-side, file type/size limits, 401/403/404 handling.

## Deploy
Any Node host (Render, Railway, Fly): build `npm install && npm run build`, start `npm start`. SQLite file is `data.db` (set `DB_PATH`); use a persistent disk.

## Known limits / next steps
Mocked auth (no passwords) · last-write-wins, no real-time sync · formatting via `execCommand` (deprecated but widely supported; I'd move to Tiptap next) · no view-only role · no version history.
