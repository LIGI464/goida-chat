# Goida Chat v1.0.0 validation

The integration branch starts at `origin/feat/invite-links` (`bc344ae`). The eight
feature commits were independent children of that base and were cherry-picked
once in this order: `52c567b`, `79c3563`, `adf87dd`, `43ce0aa`, `04d1904`,
`f2d561f`, `9da8155`, `c1ec521`. Existing feature worktrees were preserved.

## Integration changes

- Resolved App/sidebar/guest/attachment conflicts using the final principal and
  API contract; retained the LiveKit-context audio lifecycle fix.
- Unified locked invite redemption for accounts and guests; repeated redemption
  is idempotent and does not bypass revocation or exhaustion.
- Scoped attachment HTTP access and signed URLs to account or guest principals.
  Guest message writes use the actual nullable user/guest database relations.
- Reconciled Socket.IO session expiry, multi-tab presence and shutdown cleanup;
  message pagination orders by both creation time and id.
- Applied attachment storage configuration directly to Compose; the persistent
  filesystem volume is mounted at `/var/lib/goida/attachments`.
- Corrected a literal newline escape in the cursor-index migration, which had
  not been applied to production. Existing production migrations were untouched.
- Added frontend/backend revision reporting and fresh PWA/version responses.
- Removed the applied storage patch and excluded temporary files, backups and
  nested worktrees from Git/Docker delivery. Original user assets were preserved.

## Automated evidence

- Lockfile installation, Prisma generation, lint, full typecheck and build.
- Guest authorization suite: 7 tests; attachments suite: 11 tests, including
  exactly 104857600 bytes and rejection of the next byte.
- Noise metrics suite and browser lab suite, including synthetic captures and
  adapter stress runs. These do not establish acoustic quality on real speech.
- Model audio lifecycle: 100 cycles per scenario, no owned contexts/worklets/
  live tracks remaining. Noise suppression default was not changed.
- All 7 migrations apply on a clean isolated PostgreSQL database and on the
  previous production schema with synthetic sentinel data preserved; schema diff
  is empty. No production reset/db push was used.
- `services/api/test/release-integration.mjs` validates real PostgreSQL/Valkey,
  HTTP and Socket.IO, concurrent invite limits, pagination/unread, guest scope,
  logout/expiry, uploads/downloads, expiry and physical cleanup.
- `apps/web/tests/release-browser.mjs` validates registration, invites, guest
  entry, composer/realtime, rail persistence, actual LiveKit signalling/ICE/RTP
  between two Chromium clients, mute/unmute, deafen, independent camera/screen
  sources, fullscreen, chat switching, temporary offline recovery, mobile width
  and independent participant exit.
- Docker frontend/backend builds succeeded on the VPS before production stop.
  The QA matrix catalogue is preserved separately; catalogue generation alone is
  not treated as successful execution of every manual scenario.

The browser runner uses synthetic microphones. Headless fake-camera capture was
automatically muted after publication, so camera-source transport was validated
using a canvas track. Native camera capture/UI is not marked as passed.

## Human validation still required

1. On two physical devices join the same test room, speak while typing, switch
   microphone and each noise mode; compare recordings in `/audio/noise-lab`.
2. Enable a physical camera, start screen capture, cancel the native picker, then
   repeat and stop capture through the operating-system control. Verify camera
   and microphone continue and capture stays within 1920x1080 at 30 FPS.
3. Repeat on Safari/iOS and an installed existing PWA. Leave the old PWA open
   during update, reload when offered, and verify the current `/version.json`.
4. Exercise hardware device removal and a prolonged real network interruption.

Screen audio capture is disabled intentionally, so it cannot create duplicated
screen playback or local self-monitoring.

## Deployment and rollback

Back up PostgreSQL and configuration with private permissions; verify checksums,
archive parsing and a full `pg_restore --file=/dev/null` read. Build the exact PR
head while the old application runs, apply `prisma migrate deploy`, then replace
the app containers without removing PostgreSQL or attachment volumes. Verify
`/health` and `/version.json` both identify that exact commit, then run the
synthetic production smoke. Retain old images and configuration outside Git.

Application rollback uses the preserved previous checkout and image tags. Do
not automatically roll back the schema or restore an old database over newer
user data. The previous application predates nullable guest authors: before
rolling back to it, check for guest-authored messages and other incompatible new
writes. If they exist, use a compatible forward fix or reviewed application
rollback rather than silently losing new data. The backup contains the previous
commit, container/image/volume inventory, dump and private configuration.

The PR into `main` remains open until explicitly reviewed/merged. The release
tag must identify the exact deployed integration commit after production checks.
