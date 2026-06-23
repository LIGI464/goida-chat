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
- `/auth/me` returns the current user session;
- username search and direct/group chats are implemented;
- messages are stored in PostgreSQL and delivered through authenticated Socket.IO;
- chat membership is checked for chat, message and voice operations;
- LiveKit room tokens and Valkey voice presence are implemented;
- voice UI supports microphone, camera, local deafen and independent leave;
- mobile chat/list navigation and PWA build are ready;
- Docker/Caddy end-to-end smoke tests pass.

## What the owner does next

1. Open the local app:

   - frontend: http://localhost
   - backend health: http://localhost/health

2. For local development without Docker, use:

   ```powershell
   npm run dev
   ```

## Development order

1. Production deployment: VPS, DNS, HTTPS, Caddy and firewall.
2. Test camera/microphone from two real browsers over HTTPS.
3. Add LiveKit webhooks for authoritative presence after the MVP deploy.
4. Add automated PostgreSQL backup scheduling.
5. Add Capacitor Android wrapper after the web/PWA MVP is stable.
