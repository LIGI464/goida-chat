# Goida Chat roadmap

## Current state

Stage 0 is done:

- monorepo scaffold is created;
- dependencies are installed;
- Docker Compose stack is wired;
- PostgreSQL and Valkey are running locally;
- Prisma initial migration exists;
- frontend, backend, LiveKit and Caddy start through Docker Compose;
- first GitHub backup is published;
- email/password auth with username is implemented;
- protected frontend routes are wired;
- `/auth/me` returns the current user session.

## What the owner does next

1. Open the local app:

   - frontend: http://localhost
   - backend health: http://localhost/health

2. For local development without Docker, use:

   ```powershell
   npm run dev
   ```

## Development order

1. Users: search by username only.
2. Chats: direct/group creation and one shared chat list.
3. Messages: history, text validation, realtime Socket.IO delivery.
4. Voice/video: LiveKit room token endpoint and join/leave flow.
5. Voice presence: temporary state in Valkey, later LiveKit webhooks.
6. PWA polish: mobile layout, manifest icons, Android Chrome camera/mic checks.
7. Production deployment: VPS, DNS, HTTPS, Caddy, firewall and backup script.
8. Capacitor Android wrapper after the web/PWA MVP works.
