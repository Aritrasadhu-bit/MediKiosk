# MediKiosk Usability Protocol — low-literacy & elderly first-time users

The problem statement centers patients who have never used a kiosk: elderly,
low-literacy, first-visit OPD load. This protocol is how a team proves — with
numbers, not adjectives — that such a patient can complete intake unassisted,
and where attendant mode takes over when they cannot.

## 1. Unassisted-completion test (run with 5+ participants)

Recruit participants matching the target population (60+ years, or self-reported
"never used a touchscreen kiosk"). Do NOT train them; read only this script:

> "This machine registers you for the doctor. It will speak to you. Do what
> it asks. I will not help unless you ask me twice."

Tasks (each timed from screen entry to success):

| # | Task | Pass bar |
|---|------|----------|
| 1 | Choose language + start | ≤ 90s, no help |
| 2 | Enter ABHA/mobile or scan QR | ≤ 3 min, ≤ 1 help |
| 3 | Grant consent (listen to audio explanation if needed) | states back what consent means, in own words |
| 4 | Answer 3 history questions by voice OR tap | completes without attendant taking the screen |
| 5 | Confirm summary, collect token | states token number back correctly |

Score: **unassisted completion rate** = tasks passed with zero help ÷ total
tasks. Target: ≥ 80%. Anything below: fix the screen, not the patient —
typical fixes are bigger tap targets, slower/repeated audio, or fewer fields
per screen. Re-run after every fix; keep the score sheet with the SIH report.

Rules for observers: never touch the screen; count a "help" each time the
participant asks OR stalls > 60s; note the exact screen and wording that
caused it. That note is the bug report.

## 2. Attendant-assisted mode (built in)

When the patient cannot operate the kiosk, the welcome screen offers
**Attendant-assisted mode**: a helper operates the screens while audio
guidance auto-plays every stage. The encounter audit trail records
`attendant_assisted`, so a later reviewer never mistakes assisted input for
independent use — assistance is attributable, not invisible.

Attendant rules (print and pin next to the kiosk):

1. Read questions aloud exactly as shown; never paraphrase symptoms.
2. Enter what the PATIENT says, not what you think they mean.
3. Play the audio consent explanation and confirm understanding before ticking.
4. The patient (or guardian) must be present for consent — never pre-tick it.

## 3. Accessibility checklist (verify each release)

- [ ] All touch targets ≥ 44px; primary actions full-width
- [ ] Every screen has a spoken equivalent (guidance or button audio)
- [ ] Consent disclosure available in audio AND the patient's language
- [ ] No step requires reading English
- [ ] Idle-reset warning gives ≥ 30s and speaks before wiping
- [ ] High-contrast text (4.5:1) on every clinical label
- [ ] QR scan always offers "enter manually instead" (camera may fail)
