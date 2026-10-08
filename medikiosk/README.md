# MediKiosk — AI Clinical History Software Platform (SIH 26047)

An AI-powered, patient-facing kiosk platform that captures a **structured, physician-ready clinical history** through
natural **voice + touch** conversation, **digitizes physical medical documents** (prescriptions, lab reports, discharge
summaries) via OCR + entity extraction, generates a structured summary synced with the **ABDM / ABHA** ecosystem, and
surfaces it on the doctor's dashboard **before the patient enters the consultation room**.

Built for **Smart India Hackathon 26047** ("Patient Case-Taking Software").

---

## Modules (mapped to the problem statement)

| Module | What it does |
| --- | --- |
| **A — Conversational Multimodal History Engine** | Guided AI interview with adaptive SOCRATES probing, dual-mode input (speak *or* tap), multilingual ASR/TTS (Web Speech + optional Bhashini/AI4Bharat backend), bilingual Hindi-first localization + **10-language Kiosk UI dictionary** (en/hi/bn/ta/te/mr/gu/kn/ml/pa), data-driven question branching, **LLM doctor-follow-up probe** |
| **B — Medical Document Digitization & Intelligence** | Client-side OCR (Tesseract.js) with **image preprocessing** (grayscale + contrast stretch), **language selection (English + 9 regional scripts)**, **multi-page PDF support** (pdfjs-dist), structured entity extraction, abnormal-value highlighting, and **inline verification editor** so patients/pharmacists can correct AI output |
| **C — Structured History Summary Generator** | Synthesizes conversation + documents into standard format: Chief Complaint → HPI → Past → Drug/Allergy → Family → Personal → **Menstrual/Obstetric** → ROS → Prior Investigations → Red Flags, plus **drug–drug / drug–allergy interaction checks** |
| **D — Consent, Privacy & ABDM Integration** | Consent-first flow (DPDP 2023) with **five granular, separately-consented purposes enforced server-side**, audio consent explanation, session-data clearing, **real ABHA ID validation with Verhoeff checksum** (+ Aadhaar detection), **camera QR scan**, **FHIR R4 bundle export** (Patient/Encounter/Observation LOINC vitals/Composition/Provenance), consent-gated **HIS push** (FHIR or HL7 v2 MLLP), **server-side audit trail** per encounter |
| **AYUSH Mode** | Extended **Dashavidha Pariksha** intake (Prakriti, Vikriti, Agni, Koshtha, Ahara-Vihara, …) for Ayurvedic OPDs |
| **Red-Flag Detection** | Real-time priority alerts for emergency symptoms **plus numeric vitals triage** (BP crisis, hypoxia, tachy/bradycardia, high-grade fever) with high-priority triage banner on the physician dashboard |
| **Vitals Capture** | Height, weight, BP, pulse, **SpO2**, temperature at registration, **age-aware reference ranges (infant/child/adult/elderly)**, **MEWS early-warning score**, red-flag pre-triage, shown in summary/FHIR bundle |
| **Guardian / Proxy Mode** | Attendants can give history for elderly/children with guardian consent, relation tagging, and Guardian authorship in the FHIR Provenance |
| **Staff Auth & Roles** | Scrypt-hashed users (admin/doctor/nurse/pharmacist) with **department scoping**, signed httpOnly session cookies, **login lockout (5 fails → 15 min)** and **server-side session revocation**, `proxy.ts` page protection, login screen with demo accounts |
| **Physician Dashboard** | Live queue with **SLA colour bars + ETA** per urgency, **EWS score chips**, **nurse triage** and **ER escalation** (alarm + TTS + live call), **Call Next announcements** (BroadcastChannel + TTS to the kiosk screen), **e-Prescription builder with live safety + pregnancy-risk filter**, **formal A4 prescription print with QR + ICD-10 suggestions**, **doctor voice notes** (Web Speech), **longitudinal record by ABHA**, BP trend sparkline, department filter + pagination, **after-visit patient handout** (print/WhatsApp), FHIR export, delete, audit trail |
| **Waiting-Room Display** | Public TV screen (`/display`, PHI-minimised): queue board with urgency colours, **"now calling" with TTS announcement + vibration, live ETA per slot** |
| **Returning-Patient One-Tap** | On `/identify`, entering a prior ABHA/mobile auto-looks up the patient (server) → **one-tap prefill** of demographics + **duplicate-waiting-token alert** to stop double registration |
| **Offline Outbox** | Every kiosk mutation is queued locally and flushed to the server with exponential backoff (8 attempts), auto-resuming on reconnect — **nothing is lost on Wi-Fi drops** (status banner on `/done`) |
| **Voice-Command Navigation** | Tap-to-talk mic: say *Next / Back / Skip / Help / Menu / Print* in English or Hindi — the kiosk navigates itself (low-literacy access) |
| **Server Persistence & APIs** | JSON-file store (`data/encounters.json`, swappable for SQLite/Postgres) + hardened REST API: auth, encounters CRUD, **public queue feed + authenticated call-next**, **returning-patient lookup**, **server-side scan uploads** (`data/uploads/`), **admin export (JSON/CSV+BOM) + restore**, health check, **zod validation** and **rate limiting** on all routes |
| **Admin Analytics** | Hospital dashboard: intake last-7-days, by-department, red-flag triggers, triage/ER counts, guardian/AYUSH/FHIR stats, **one-click export (JSON / CSV for Excel) with SHA-256 manifest + auto-backup rotation**, **restore from backup**, **one-click demo reset** (re-seeds demo patients), **encryption / cookie-hardening badges**, backup list |
| **Escalation Engine** | Age-aware **MEWS** + red flags + vitals thresholds route patients to **ER (auto status + SMS/WhatsApp notify)** or **triage** automatically on kiosk submission; ER iff MEWS ≥ 5, SpO₂ < 90, SBP ≥ 200 / ≤ 80, temp ≥ 40.5 °C, pulse ≥ 140 / ≤ 40 — tested, visible on nurse + physician screens |
| **Nurse Triage Screen** | `/triage` (role-gated): priority-sorted queue by escalation score, **re-capture vitals**, mark triage complete, escalate to ER — every action audited with the acting user |
| **Pharmacy Screen** | `/pharmacy` (role-gated): pending-fulfilment queue of confirmed prescriptions, **mark dispensed** (writes `dispensedAt` + audit) and dispensed history |
| **Patient QR Portal** | `/p/{encounterId}` (public, **HMAC access code** from the printed token QR): live queue position + ETA, clinical summary, prescription, vitals, **grant/revoke consent live**, **download FHIR record**, print. Codes are unguessable — records can't be enumerated |
| **Smart Wait-Time** | EWMA-smoothed actual consult durations (per department, 6 s+ filter, clamped 2–30 min) drive **live ETA on the display, physician queue and `/api/queue/position/{token}`** (the QR on the token slip) |
| **AI Scribe + Differentials** | `/api/rx/dictate` turns doctor dictation into a structured Rx draft (LLM when keyed, deterministic parser offline) appended into the e-Prescription with the same pregnancy/interaction safety checks; `/api/patient/[id]/ai` shows **possible differentials + questions to ask** (rule-based offline, LLM when keyed) |
| **Appointments + Kiosk Check-in** | Public **appointment booking** (name/mobile/dept/date/slot), **lookup by mobile**, and **one-tap check-in on `/identify`** when today's slot matches — booked patients slide into the queue |
| **ABDM Sandbox Gateway** | `/api/abdm/consent` (portal-code gated) mints the **actual consent-manuscript + health-information wire format** the NDHM sandbox uses (HealthID verify with Verhoeff, care-context, base64 FHIR HI report, consent artefact) — fully local & deterministic, unit-tested |
| **Deep Health Check** | `GET /api/health` now probes **data-dir writability, disk free bytes, store files, appointments/backups counts**, encryption + cookie-hardening flags and feature capabilities |
| **Crash-Safe + Encrypted Store** | Every store write is **tmp → rename → `.bak` snapshot** with read-fallback (no torn/partial files); optional **AES-256-GCM PHI at rest** via `MEDIKIOSK_ENCRYPT_PHI=1` (key from `SESSION_SECRET`) — wrong secret / tampering fails loudly |
| **CSRF + Cookie Hardening** | State-changing routes run a **same-origin CSRF guard** (no-Origin client requests still allowed); opt-in **`__Host-` cookie prefix** (Secure + HTTPS) via `MEDIKIOSK_HOST_COOKIE_PREFIX=1` |
| **Security Headers** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy, COOP, HSTS on every response |
| **Tests & CI** | **220 unit tests** (red-flags incl. age-aware vitals + MEWS, interactions incl. pregnancy risk, queue/SLA/ETA + EWMA, voice commands, outbox, extraction, FHIR bundle, ABHA/Verhoeff, i18n, summarizer, escalation, AI clinical, crypto, ABDM sandbox, **granular-consent enforcement, CSRF same-origin guard, HL7 v2 wire format, production secret policy**) with Vitest; GitHub Actions e2e: typecheck → lint → test → build → **runtime smokes against a fresh data dir** (`scripts/*.mjs`) |
| **Docker & DevEx** | Standalone-server Dockerfile + volume-persisted `data/`, `.dockerignore`, `.env.example`, health endpoint `GET /api/health` (now also reports the baked image `build.id`/`build.time` via `BUILD_ID`/`BUILD_TIME` args — visible on the admin deployment card) |
| **Accessibility (A11y)** | Global ♿ toggle — high contrast, larger text, reduced motion; respects `prefers-reduced-motion` |
| **After-Visit Summary** | Printable/WhatsApp patient handout with diagnosis, prescription, advice, follow-up |
| **Full-UI Translations** | `src/lib/i18n.ts` — 10-language core UI dictionary with English fallback (hi/bn/ta/te/mr/gu curated; kn/ml/pa best-effort) |

## Tech Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS v4, `proxy.ts` page protection)
- **Web Speech API** + optional **Bhashini / AI4Bharat ASR** — multilingual speech recognition & TTS
- **Tesseract.js** + **pdfjs-dist** — in-browser OCR of images and multi-page PDFs
- **Rules engine + optional OpenAI** (`OPENAI_API_KEY`) for document structuring, summary synthesis, AI follow-up
- **zod** — API request validation · **scrypt + HMAC-SHA256 cookies** — zero-dependency staff auth
- **Vitest** — unit tests for all pure logic modules
- **qrcode.react** — patient token QR / after-visit handout; **BarcodeDetector** — camera scan of ABHA/Aadhaar QR
- **JSON-file server store** (`src/lib/server/db.ts`) with mutex + merge-by-`updatedAt`; **SQLite engine**
  (Node's built-in `node:sqlite`) that fresh data dirs take automatically, falling back to JSON when unavailable.
  Existing JSON stores keep working until migrated (`npm run migrate:json-sqlite`). Rule of thumb: JSON for
  demos/single-kiosk pilots, SQLite beyond that.
- **Scheduled backups** (SHA-256 manifest + restore drill) and **maintenance mode** to keep an operator window safe
- **localStorage + BroadcastChannel** — ephemeral kiosk session + live queue/announcements

> All core features run offline; the kiosk persists encounters to the server (JSON or SQLite store) and merges across
> devices.

### What is real vs. simulated

Judges and reviewers should be able to tell at a glance which parts of this system actually talk to
something outside the process. Being explicit here is deliberate.

| Capability | Status |
| --- | --- |
| History capture, OCR, entity extraction, interaction checks, red flags, queue, Rx, FHIR R4 bundle | **Real and offline.** No external service involved. |
| Summary generation | **Deterministic rules engine by default** (string assembly over validated fields). If `OPENAI_API_KEY` is set, a model drafts a narrative that is prepended to — never substituted for — the structured record. The UI labels which one produced the text. |
| HIS/EMR push | **Real transports, off by default.** Set `MEDIKIOSK_HIS_MODE=fhir` (FHIR R4 POST) or `hl7v2` (MLLP ORU^R01) plus the endpoint. With nothing configured the delivery attempt is logged as `not_configured` and the kiosk says exactly that. Only happens if the patient ticked the "send to hospital system" consent box. |
| ABDM / ABHA | **Local only.** The consent manuscript, HealthID verification and base64 FHIR health-information report match the NDHM sandbox wire format and are unit-tested, but nothing is transmitted to a gateway. The portal says "prepared locally", not "linked". |
| Speech-to-text | **Real via the browser Web Speech API**, optionally routed to Bhashini/AI4Bharat when those keys are set. |
| Bilingual output | **Real.** Patient-facing section headings and the spoken confirmation are localized from a 10-language dictionary; clinical prose stays exactly as the patient or document recorded it. |

## Getting Started

```bash
# 1. install dependencies
npm install

# 2. configure (optional)
copy .env.example .env.local   # SESSION_SECRET, OPENAI_API_KEY, ASR keys

# 3. run
npm run dev
# open http://localhost:3000
```

Production build:

```bash
npm run build
npm run start
```

### Docker

```bash
docker build -t medikiosk .
# SESSION_SECRET is mandatory — the server refuses to start without a real one.
docker run -p 3000:3000 -v medikiosk-data:/app/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" medikiosk
```

### Tests & checks

```bash
npm test          # unit tests (vitest run) — red flags, age-aware vitals + MEWS,
                  # interactions + pregnancy risk, queue/SLA/ETA + EWMA, voice commands,
                  # outbox, extraction, FHIR, ABHA/Verhoeff, i18n, summarizer,
                  # escalation engine, AI clinical parser, crypto, ABDM sandbox,
                  # surveillance clusters, pictogram prescriptions, OPD register,
                  # referral slips, storage-engine selection, consent enforcement,
                  # CSRF guard, HL7 ORU^R01 wire format, session-secret policy
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # production build
npm run smoke     # runtime API smokes — run against a freshly-started server:
                  #   scripts/medikiosk-smoke.mjs    (auth, encounters CRUD, rate limit)
                  #   scripts/medikiosk-smoke2.mjs   (queue, lookup, docs, export/restore)
                  #   scripts/medikiosk-smoke3.mjs   (portal, consent, FHIR, ABDM, AI,
                  #                                   appointments, reset, backups, CSRF)
                  #   scripts/medikiosk-smoke4.mjs   (setup, config, manifest, thermal
                  #                                   slip, living-hospital demo)
                  #   scripts/medikiosk-smoke5.mjs   (engine, queue self-heal,
                  #                                   maintenance guard, backup drill)
                  #   scripts/medikiosk-smoke6.mjs   (concurrency: parallel kiosk
                  #                                   arrivals, stale-write dedupe,
                  #                                   last-write-wins)
                  #   scripts/medikiosk-lockout.mjs  (account lockout, fresh limiter)
```

CI (`.github/workflows/e2e.yml`) runs all of the above against a fresh
`MEDIKIOSK_DATA_DIR`, then boots the production build and executes the smoke
suite end-to-end.

## End-to-End Kiosk Flow (the demo)

1. **Welcome** (`/`) — choose language (10 available) + clinic type (Allopathic / AYUSH). Audio prompt guides the user.
2. **Identify** (`/identify`) — **real ABHA ID validation with Verhoeff checksum** (14-digit) or camera QR scan, demographics,
   **returning-patient one-tap** (prefill + duplicate-token alert), **vitals + SpO2** with age-aware live red-flag/MEWS
   pre-triage, **guardian/proxy mode**, explicit **consent** (audio explained). Say *"Next"* (or *"आगे"*) to navigate by voice.
3. **Converse** (`/history`) — adaptive interview: complaint grid → SOCRATES → open HPI → past/surgical/meds/allergies
   → family → personal → **women's health (menstrual + obstetric for female patients)** → ROS → (AYUSH pariksha).
   **Red flags** detected live.
4. **Scan** (`/scan`) — upload photos/PDFs; preprocessed multilingual OCR, entity extraction, abnormal-value flags,
   **edit/verify AI output** inline. Scans are **stored on the server** and linked to the physician record.
5. **Summary** (`/summary`) — generated draft in clinical format; red-flag banner; **interaction alerts**; confirm → saves
   to server, issues **encounter ID + queue token**.
6. **Done** (`/done`) — token + QR, ABHA/HIS sync status, **print token slip** + **80mm thermal slip**
   (`/slip/{token}`, re-printable by token), **live "Your Turn" call** announcement.
   If the Wi-Fi drops mid-submit, the offline **outbox** keeps the record and flushes it when the connection returns.
7. **Staff Login** (`/login`) — doctor / nurse / pharmacist / admin (demo: `doctor/doctor123` etc.). On a fresh install
   the **first-run setup wizard** (`/setup`) captures the hospital name, kiosk departments and the admin credentials.
   Failed logins lock the account for 15 min; logout revokes the session server-side.
8. **Physician Dashboard** (`/physician`, protected) — live queue with **SLA colour + smart ETA (EWMA)**, department filter + pagination,
   **nurse triage** and **ER escalation** (alarm + TTS), **🧠 AI assistant** (differentials + questions to ask), **🎙️ AI scribe
   dictation → Rx draft**, **🔔 Call Next** (announced on the waiting-room display),
   longitudinal record by ABHA + BP trend, **e-Prescription with live safety + pregnancy-risk filter**, **formal A4
   prescription print (QR + ICD-10)**, **voice notes**, **after-visit handout** (print/WhatsApp), FHIR export, delete,
   confirm-to-EMR.
9. **Waiting-Room Display** (`/display`) — TV queue board with urgency colours + **EWMA ETA** and "now calling" TTS announcements.
10. **Nurse Triage** (`/triage`, nurse/doctor/admin) — priority-sorted by escalation score, re-capture vitals, mark triage, escalate ER.
11. **Pharmacy** (`/pharmacy`, pharmacist/admin) — fulfil confirmed prescriptions (**mark dispensed** → `dispensedAt` + audit),
    **pictogram prescription handout** (✔/✖/⚠ medication pictograms) plus formal printed pharmacy slip.
12. **Admin Analytics** (`/admin`, admin only) — intake charts, triage/ER counts, department breakdown, red-flag triggers,
    **export JSON/CSV (SHA-256 manifest + auto-backup)**, **restore + restore drill**, **backup list**, **one-click demo reset**,
    **syndromic surveillance cluster alerts** (72h buckets + CSV), **daily OPD register** (CSV/printable, DHIS/RCH-style),
    **living-hospital demo** (scripted patient arrivals + auto-advancing queue), **maintenance mode** toggle, encryption badges.
13. **Patient Portal** (`/p/{id}?code=…` from the printed token QR) — queue position + ETA, record summary, prescription
    (+ pictograms), **grant/revoke consent**, **download FHIR**, **send to ABDM app (sandbox)**, print.
14. **Screening Camp** (`/camp`, offline-friendly) — high-throughput outreach capture (name/age/symptoms/village) that flows
    into the queue, register and surveillance feeds; offline captures replay through the outbox.
15. **Referral slips** — ER/triage escalations auto-generate a printable structured referral slip
    (`/api/referral/{id}`) the patient carries to the destination facility.

PWA: installable ("📲 Install MediKiosk") with a validated web-app manifest + **offline fallback page**; works offline
after first load; idle session watchdog clears patient data after 2 minutes of inactivity (DPDP 2023).

## API Surface

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | — / — / cookie | Staff session (httpOnly signed cookie, lockout, server-side revocation, optional `__Host-` prefix) |
| `POST /api/encounters` | public (kiosk) | Submit a clinical-history encounter — **auto-runs the escalation engine** (ER status + notify on dangerous vitals) |
| `GET /api/encounters` | cookie | List encounters (queue / analytics) |
| `GET/PATCH/DELETE /api/encounters/[id]` | cookie | Read / update (**vitals merge at triage, pharmacy `dispensedAt`**, note, prescription, status, audit) / delete |
| `POST /api/encounters/seed` | cookie | Load demo patients |
| `GET /api/queue` | public | **Sanitised waiting-room feed** (name-initial only, urgency, wait, **EWMA-smoothed ETA**, current call) |
| `POST /api/queue` | cookie | **Call next / clear call** (TTS announcement + queue-state file + audit) |
| `GET /api/queue/position/[token]` | public | **Live queue position + ETA by token** — the QR on the printed token slip points here |
| `POST /api/patient/lookup` | public | **Returning-patient one-tap + duplicate-waiting detection** (ABHA/mobile) |
| `GET /api/patient/portal/[id]` | public + **portal code** | Patient's own record: summary, vitals, prescription, **queue position**, consent status |
| `POST /api/patient/portal/[id]/consent` | public + **portal code** | **Grant / revoke record consent live** (audited, patient-controlled) |
| `GET /api/patient/portal/[id]/fhir` | public + **portal code** | **Download your own FHIR R4 bundle** |
| `POST /api/abdm/consent` | public + **portal code** | **ABDM sandbox**: build consent-manuscript + HI report (base64 FHIR) |
| `GET /api/patient/[id]/ai` | cookie | **Differentials + suggested questions** (LLM when keyed, rules offline) |
| `POST /api/rx/dictate` | cookie | **AI scribe**: dictation → structured Rx draft |
| `POST /api/appointments` · `GET /api/appointments?mobile=` | public | **Book / look up** a slot (name/mobile/dept/date/slot) |
| `POST /api/appointments/checkin` | public | **Check in** a booked slot (slides into the queue) |
| `POST /api/documents` · `GET /api/documents/[id]` | public | **Server-side scan upload** (base64, downscaled) + served image |
| `GET /api/admin/export` · `POST /api/admin/restore` | admin | **Backup: JSON/CSV export (SHA-256 manifest + auto-backup), restore (merge-by-id)** |
| `GET /api/admin/backups` | admin | **List archived backups** (SHA-256 sidecar hashes, retention 7) |
| `POST /api/admin/reset` | admin | **One-click demo reset** — wipe encounters/queue/appointments + re-seed demo patients |
| `POST /api/fhir` | cookie | FHIR R4 document Bundle export |
| `GET /api/health` | — | **Deep health**: liveness, storage probe, disk free bytes, security/capability flags |
| `POST /api/extract` · `/api/summarize` · `/api/asr` · `/api/converse` | public, rate-limited | Rules engine (with optional LLM/ASR backends) |
| `GET /api/config` | — | Capability probe |

API hardening: every state-changing route runs a **same-origin CSRF guard**, input is parsed through **zod** schemas
(`src/lib/validation.ts`), and public endpoints are wrapped by an in-memory **rate limiter**
(`src/lib/server/rateLimit.ts`).

## Project Structure

```
src/
├── proxy.ts               # Next 16 page protection for /physician, /triage, /pharmacy, /admin
├── app/
│   ├── page.tsx           # Welcome — language (10) + mode picker
│   ├── login/             # Staff login (demo accounts, lockout)
│   ├── identify/          # ABHA/QR + returning-patient one-tap + duplicate alert + appt check-in
│   ├── history/           # Conversational history engine (+ women's health stage)
│   ├── scan/              # OCR/PDF pipeline with verification editor (server uploads)
│   ├── summary/           # Summary, interaction check, server save, token
│   ├── done/              # Token + QR + live Call-Next listener + sync banner
│   ├── physician/         # Queue (SLA/ETA), AI panel + scribe, triage/ER, Rx print 🔒
│   ├── triage/            # Nurse queue (escalation-priority, vitals re-capture) 🔒
│   ├── pharmacy/          # Prescription fulfilment (mark dispensed) 🔒
│   ├── p/[id]/            # Patient portal — code-gated record + consent + FHIR 🔓
│   ├── display/           # Public waiting-room TV queue 🔓
│   ├── admin/             # Hospital analytics + export/restore/reset/backups 🔒 (admin)
│   ├── manifest.ts        # PWA web manifest
│   └── api/               # auth, encounters, queue, patient/lookup, documents,
│                          # admin/export, admin/restore, fhir, extract, summarize,
│                          # asr, converse, config, health
├── components/            # VoiceButton, QrScanner, PwaBootstrap, SessionWatchdog,
│                          # A11yToggle, VoiceNav, SyncBanner
└── lib/
    ├── types.ts           # Clinical data model (FHIR-ready) + EncounterStatus/queue
    ├── server/            # db (crash-safe JSON store + backups + reset), auth (scrypt/HMAC,
    │                      #   sessions, lockout, departments), rateLimit, log, notify,
    │                      #   portal (HMAC codes), csrf, appointments-db, llm (shared)
    ├── cookieName.ts      # __Host- session cookie name (opt-in hardening)
    ├── queue.ts           # SLA levels, ETA, EWMA consult smoothing, queue position (tested)
    ├── escalation.ts      # Escalation policy engine: ER / triage thresholds (tested)
    ├── clinical.ts        # AI fallback: differentials, questions, Rx dictation parser (tested)
    ├── abdm.ts            # ABDM sandbox gateway: verify HealthID, consent, HI report (tested)
    ├── crypto.ts          # AES-256-GCM encrypt/decrypt + sha256 (tested)
    ├── commands.ts        # English/Hindi voice-command matcher (tested)
    ├── outbox.ts          # Offline write queue + backoff (tested)
    ├── validation.ts      # zod schemas (incl. appointments, dictate, portal consent)
    ├── extractor.ts       # Pure OCR post-processing heuristics (tested)
    ├── summarizer.ts      # Template summary + after-visit handout (tested)
    ├── fhirBundle.ts      # FHIR R4 bundle builder (tested)
    ├── redflags.ts        # Text + age-aware vitals + MEWS rules (tested)
    ├── interactions.ts    # Drug–drug / drug–allergy / pregnancy safety (tested)
    ├── abha.ts            # ABHA (Verhoeff) / Aadhaar / mobile validation (tested)
    ├── i18n.ts            # 10-language UI dictionary (tested)
    ├── imageProcess.ts    # Canvas preprocessing for OCR
    ├── callChannel.ts     # BroadcastChannel queue announcements
    ├── store.ts           # Local + server merge, audit, tokens
    ├── useSession.ts      # Shared kiosk state
    └── demoData.ts        # Stable-ID demo encounters
scripts/                    # Runtime smoke suite (lockout, smoke1-3) for local + CI
data/                      # Server persistence: users.json, encounters.json,
                           # sessions.json, lockouts.json, queue-state.json,
                           # uploads/, logs/ (git-ignored)
```

## Environment

| Var | Purpose |
| --- | --- |
| `SESSION_SECRET` | **Required in production, min 32 chars.** Signs the staff auth cookie **and derives the PHI encryption key**. There is no fallback: the server refuses to sign in production without it, and in development it generates one into `data/.dev-session-secret`. Values that still look like a template (`replace-me`, `CHANGE_ME`, a run of `x`s, an unfilled `<...>`) are rejected exactly as firmly as an empty value, so copying `.env.example` verbatim fails to start rather than signing with a published key. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `OPENAI_API_KEY` | Optional. LLM extraction/summarization, AI scribe + differential panels; offline rules otherwise. |
| `MEDIKIOSK_HIS_MODE` | Optional, default `off`. `fhir` or `hl7v2` to actually push encounters to a hospital system. |
| `MEDIKIOSK_HIS_FHIR_URL` | FHIR R4 endpoint used when `MEDIKIOSK_HIS_MODE=fhir`. |
| `MEDIKIOSK_HIS_HL7_HOST` / `_PORT` | Interface and port used when `MEDIKIOSK_HIS_MODE=hl7v2` (MLLP). |
| `AI4BHARAT_ASR_URL` | Optional. Full AI4Bharat ASR endpoint. |
| `BHASHINI_API_KEY` etc. | Optional. Bhashini pipeline for Indian-language speech-to-text. Falls back to Web Speech API. |
| `MEDIKIOSK_DATA_DIR` | Optional. JSON store directory (default `data`). CI uses a fresh dir per run. |
| `MEDIKIOSK_ENCRYPT_PHI=1` | Optional. **AES-256-GCM encryption of the encounter store at rest** (key from `SESSION_SECRET`). Tampered / wrong-secret fails loudly. |
| `MEDIKIOSK_HOST_COOKIE_PREFIX=1` | Optional. **`__Host-` session cookie** (requires HTTPS/Secure; off for plain-http demos). |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | Optional. In-memory API rate limiting (default 120 req/min). |

## Security & Privacy (Module D)

- **Consent-first**: no capture without explicit, revocable consent — with audio explanation for low-literacy patients.
  The patient portal adds **live grant/revoke** from the token QR.
  Consent is **granular**: capture, clinical care, document processing, ABHA linking and HIS/EMR export are
  separate checkboxes, and the server enforces them on every staff read. Revoking clinical-care consent hides
  the record from the physician, nurse and pharmacy views immediately, not only from the patient portal.
- **Ephemeral kiosk session**: cleared immediately after the encounter is submitted.
- **Staff auth**: scrypt password hashes, signed httpOnly cookies (opt-in `__Host-` prefix), `proxy.ts` page protection.
- **CSRF**: same-origin guard on every state-changing route.
- **PHI at rest**: optional AES-256-GCM store encryption (`MEDIKIOSK_ENCRYPT_PHI=1`).
- **Crash-safe writes**: tmp → rename → `.bak` snapshot with read-fallback; automated SHA-256-manifested backups (retention 7).
- **Guardian mode**: proxy respondents give explicit consent and are recorded in the FHIR Provenance.
- **Draft, not diagnosis**: the physician keeps full control — the summary is always a draft to accept, amend, or reject.
- **Honest provenance**: the UI never claims more than happened. It distinguishes the offline rules engine from a
  model-drafted narrative, says "prepared locally" for ABDM payloads that were not transmitted, and reports
  `not_configured` for an HIS push with no endpoint rather than a green tick.
- **ABDM-ready**: sandbox gateway models the real consent + HI wire format; swap `src/lib/server/db.ts` and the API routes
  for live HIE (Health Information Exchange) endpoints and ABHA verification.

---

Submission for **SIH 2026 — Problem Statement SIH26047**. License: CC-BY-4.0.