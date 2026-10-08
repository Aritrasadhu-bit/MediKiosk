# MediKiosk Operator Runbook

One page for the person on call. All commands run from the project root
(or inside the container at `/app`) unless noted.

## 1. Offsite backups (do this weekly at minimum)

Local snapshots (`data/backups/`, SHA-256 sidecars, retention 7) die with the
disk they sit on. Push them elsewhere and prove the copy:

```sh
# USB stick / mounted share (works everywhere, no dependencies)
node scripts/medikiosk-offsite.mjs push --dest=/mnt/usb/medikiosk
node scripts/medikiosk-offsite.mjs verify --dest=/mnt/usb/medikiosk

# Over SSH (needs `rsync` on this machine)
node scripts/medikiosk-offsite.mjs push --dest=backup@nas:/srv/medikiosk

# S3-compatible (needs the AWS CLI configured)
node scripts/medikiosk-offsite.mjs push --dest=s3://hospital-backups/medikiosk
```

`verify` compares every snapshot hash-for-hash and exits non-zero on the
first mismatch — a corrupt offsite copy must never be discovered during an
actual restore. `verify`/`pull` support local paths only: for SSH/S3, sync
the files down first, then verify against the download.

## 2. Restore from offsite (after disk loss / migration)

```sh
# 1. Pull snapshots into a quarantine dir (NEVER over live data files)
node scripts/medikiosk-offsite.mjs pull --dest=/mnt/usb/medikiosk
#    → lands in data/backups-restored/

# 2. Re-import through the app so merge rules apply:
#    Admin → Backups → restore. Last-write-wins merge means an older backup
#    can never clobber newer live rows.

# 3. Prove it: Admin → "Run restore drill" must report SHA-256 ok.
#    The outcome persists (Admin → Backups → last-drill line).
```

## 3. Disk full

Symptoms: `data directory is not writable` / `low disk space` warnings on
`/api/health`, writes refused. Order of operations:

1. Push the newest snapshot offsite (section 1) — do this FIRST, so nothing
   below risks the only copy.
2. Free space: prune `data/logs/app.log`, old files in `data/backups/`
   beyond retention, expired `data/uploads/` (capability links expire after
   30 days and are reclaimed on access).
3. Never delete `encounters.json` / `medikiosk.db` / `users.json` /
   `sessions.json` to "make room" — that is data loss, not cleanup.

## 4. Secret rotation (SESSION_SECRET)

The secret signs sessions AND derives the PHI-at-rest key. Rotation
invalidates all sessions (staff sign in again — expected) and, critically,
**orphans encrypted stores**: an encrypted `encounters.json` / SQLite rows
cannot be decrypted under the new secret.

1. Take a backup (Admin → Backups) and push it offsite (section 1).
2. If PHI encryption is on: run the restore drill first, then rotate, then
   re-import — or simpler, decrypt-then-rotate: temporarily start with the
   OLD secret, export, switch secret, restore via Admin → restore.
3. Never commit the new value; never reuse a published/template value — the
   server refuses placeholders in production and will not start.

## 5. Restore drill (routine proof)

Admin → Backups → "Run restore drill": snapshot → SHA-256 verify → merge
re-import. Safe on a live system (merge never overwrites newer rows). Run
monthly; the persisted outcome is the evidence auditors ask for.

## 6. TLS (public deployments only)

LAN-only kiosks (bare IP, no domain): use the base compose file as-is over
the trusted VLAN. Certificates cannot be issued for IPs — do not enable the
TLS overlay there.

With a real domain pointing at the host:

```sh
DOMAIN=kiosk.hospital.example docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

This adds Caddy (automatic HTTPS on 80/443, HSTS) in front of the app and
flips on `MEDIKIOSK_TRUST_PROXY`, `MEDIKIOSK_SECURE_COOKIE` and
`MEDIKIOSK_HOST_COOKIE_PREFIX`. Those cookie flags REQUIRE https — browsers
drop Secure cookies over plain http and login breaks, which is why they stay
off in the base file. The app's CSRF origin check and rate-limit client-IP
buckets read the real browser values from Caddy's sanitized
`X-Forwarded-*` headers.
