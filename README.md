# LV Network Sketch

A touch-friendly web app for sketching low-voltage electrical networks in the field:
poles, transformers, cables, subscribers, distances and pole conditions, with
project save/load, JSON import/export and A4 PDF export.

Originally built on YouWare; the untouched original source is kept on the
`original-youware` branch.

## Tech stack

React 18 · TypeScript · Vite 7 · Tailwind CSS 3 · Zustand · SVG rendering ·
IndexedDB (`idb-keyval`) · `html2canvas` + `jspdf` for PDF export.

## Development

Requires Node.js 20+ and npm.

```bash
npm ci          # clean install from package-lock.json
npm run dev     # dev server at http://127.0.0.1:5173
npm run build   # production build into dist/
npm run preview # serve the production build
npx tsc -p tsconfig.app.json --noEmit   # type check
```

These commands are meant to run in a cloud environment (e.g. a Claude Code
session or GitHub Codespaces) — nothing has to be run on a phone.

## Project layout

```
src/
  components/   UI and canvas (SketchCanvas = editor, PreviewCanvas = A4/print)
  store/        Zustand drawing store (elements, history, settings)
  utils/        cable layout, SVG helpers, storage, serialization, file pickers
  types/        drawing data model
docs/ARCHITECTURE.md   detailed architecture and rendering notes
```

## Notes

- Projects are stored in the browser's IndexedDB; export JSON to back them up.
- Never commit secrets or `.env` files (they are git-ignored).
