# Goida Chat roadmap

## Current state

Stage 0 is done:

- monorepo scaffold is created;
- dependencies are installed;
- Docker Compose stack is wired;
- PostgreSQL and Valkey are running locally;
- Prisma initial migration exists;
- frontend, backend, LiveKit and Caddy start through Docker Compose;
- first local Git commit is ready.

## What the owner does next

1. Log in to GitHub CLI in a normal terminal:

   ```powershell
   & "C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol https --web
   ```

2. Create the remote private repository and push the backup:

   ```powershell
   & "C:\Program Files\GitHub CLI\gh.exe" repo create goida-chat --private --source . --remote origin --push
   ```

3. Open the local app:

   - frontend: http://localhost
   - backend health: http://api.localhost/health

## Development order

1. Auth: Better Auth, signup, signin, signout, `/auth/me`.
2. Users: search by username only.
3. Chats: direct/group creation and one shared chat list.
4. Messages: history, text validation, realtime Socket.IO delivery.
5. Voice/video: LiveKit room token endpoint and join/leave flow.
6. Voice presence: temporary state in Valkey, later LiveKit webhooks.
7. PWA polish: mobile layout, manifest icons, Android Chrome camera/mic checks.
8. Production deployment: VPS, DNS, HTTPS, Caddy, firewall and backup script.
9. Capacitor Android wrapper after the web/PWA MVP works.

