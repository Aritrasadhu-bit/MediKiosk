# MediKiosk — AI Clinical History Kiosk (SIH 26047)

Unattended hospital OPD kiosk: patients register, describe symptoms in their
own language (10 Indian languages + voice input), upload medical documents,
and receive a queue token — clinical staff review the structured,
physician-ready record on the doctor's dashboard before the consultation.

Built for **Smart India Hackathon 26047** ("Patient Case-Taking Software").

The application lives in **[`medikiosk/`](medikiosk/)** — full documentation,
module map, setup, and runbook are in **[`medikiosk/README.md`](medikiosk/README.md)**.

## Quickstart

```bash
cd medikiosk
npm install
cp .env.example .env.local   # fill in secrets/keys
npm run dev                  # http://localhost:3000
```

| Script | Purpose |
| ------ | ------- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Vitest unit suite (440+ tests) |
| `npm run test:e2e` | End-to-end kiosk loop vs a running server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

## Highlights

- **10-language kiosk UI** (en/hi/bn/ta/te/mr/gu/kn/ml/pa) with per-key English fallback
- **Voice dictation** (continuous recognition, append mode) + spoken guidance
- **Offline-first**: every write queues locally and syncs with backoff
- **Staff portals**: physician, triage, pharmacy, admin + waiting-room display
- **ABDM/ABHA ready**: Verhoeff-checked IDs, FHIR R4 export, consent-gated HIS push
- **Patient portal** (`/p/{id}`) + token SMS + appointment reminders

## Layout

```
medikiosk/
  src/app/        # routes: kiosk flow, staff portals, display, portal, APIs
  src/lib/        # i18n, clinical logic, offline outbox, server stores
  src/components/ # kiosk UI (BodyMap, voice, shell, banners)
  scripts/        # E2E loop, smoke tests, migrations
  docs/           # runbook, usability notes
  data/           # runtime JSON store (git-ignored, never commit PHI)
```
