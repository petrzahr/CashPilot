# CashPilot

Personal finance SPA with a 12-month balance forecast. Client-only: data lives in the browser and syncs to the user's Google Drive. Live at https://cashpilot.byzahr.app.

## Development

```bash
npm install
npm run dev      # dev server on port 3000 (or double-click start.bat)
npm test         # unit tests (Vitest)
npm run build    # tsc + vite build
```

Local dev needs `VITE_GOOGLE_CLIENT_ID` in `.env.local`.

## Docs

- `AGENTS.md` - project rules for coding agents (`CLAUDE.md` imports it)
- `DESIGN.md` - design system rules
- `PRODUCT.md` - product principles
- `docs/synchronization-v2.md` - Google Drive sync design
