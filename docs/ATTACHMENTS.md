# Chat attachments

`POST /chats/:chatId/attachments` accepts one `file` and an optional `text`
field (up to 4,000 characters) as streaming `multipart/form-data`. The successful
response is `{ message }` (201); the same message is broadcast over Socket.IO.
The global Fastify JSON body limit remains 64 KiB. Uploads are bounded to
100 MiB (104,857,600 bytes), one file, one field and ten minutes. No binary data
is stored in PostgreSQL or encoded as JSON. The browser sends a selected file
only when the user clicks Send; cancellation aborts the HTTP request.

Supported extensions: jpg, jpeg, png, gif, webp, pdf, txt, csv, json, mp3, wav,
mp4. Extension and MIME must agree (a missing/generic browser MIME is inferred
from the allowlist). A bounded header check validates binary signatures; text
files are checked as UTF-8 throughout the stream. Executable/script extensions,
disguised executable signatures, SVG/HTML, archives and container documents are
rejected. This is format validation, not an antivirus scanner. Text uploads,
including JSON/CSV, are treated as opaque text, not parsed or executed.

Authentication and membership are required before upload, URL issuance and
download. Membership is checked again at commit. Uploads are limited to ten
attempts per IP per minute and ten attempts per account per ten minutes (Valkey,
shared between API replicas). Cross-site multipart POSTs are rejected.

`GET /chats/:chatId/attachments/:attachmentId/url?mode=download|preview` returns
`{ url, expiresAt }`. URLs are relative to the configured API base and signed
using a domain-separated HMAC with `BETTER_AUTH_SECRET`; rotating that secret
invalidates links. A URL expires within five minutes or at the retention
deadline, whichever comes first, and is bound to the logged-in user and mode.
It still requires a session and current membership, so forwarding it is not an
access grant. Preview mode serves only allowlisted raster images inline; all
other downloads force attachment disposition with `nosniff`, no-store and a
restrictive CSP. The UI refreshes previews and requests a new URL for each
download click. Do not log signed query strings at the reverse proxy.

Each attachment expires 14 days after its upload begins. Reads enforce the
deadline even if the cleanup job is delayed, return 410, and show
“Срок хранения вложения истёк.” Metadata is retained to display this state.
The in-process cleanup job runs at startup and every minute, in batches of 100.
It marks expired attachments, abandoned uploads older than 20 minutes, and
files whose message was deleted. Deletion failures are logged and retried;
the job stops and awaits any current pass during graceful API shutdown.
`messageId` uses `ON DELETE SET NULL` so deleting a chat cannot hide storage
objects from cleanup. Empty/partial/invalid uploads are cleaned immediately
when possible. Persisting the storage key before receiving bytes also makes
interrupted uploads recoverable by cleanup after a crash.

## Deployment

1. Run `npm ci`, `npm run db:generate`, then `npm run db:deploy` against the
   intended PostgreSQL database before starting the new API.
2. Set `ATTACHMENTS_STORAGE_ROOT` to a private writable directory on persistent
   storage, outside static web roots. The default is `data/attachments` relative
   to the API process working directory. Files use generated keys, directory
   mode 0700 and file mode 0600. The adapter interface allows replacement with
   an object store without changing the upload or authorization contract.
3. For Docker, review and apply `integration-patches/attachments-storage.patch`:
   `git apply --check integration-patches/attachments-storage.patch`, then
   `git apply integration-patches/attachments-storage.patch`. This mounts a
   dedicated named volume; the main Compose file is intentionally unchanged.
   Existing Caddy `/chats/*` routing already covers uploads and downloads.
4. All API replicas must share the same storage directory and signing secret.
   Do not scale filesystem-backed replicas across independent disks. Configure
   any external proxy to stream requests and allow a 100 MiB file plus multipart
   overhead. Monitor disk capacity and cleanup error logs. Do not publicly serve
   the volume. Backup retention must be managed separately from live file expiry.

Verification: `npm run test:attachments -w @goida-chat/api`, `npm run lint`,
`npm run typecheck`, `npm run build`.
