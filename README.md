# Goida Chat

Минимальный приватный web/PWA-чат с постоянной voice/video-комнатой в каждом чате.

## Что уже работает

- npm workspaces monorepo: React frontend, Fastify API, shared Zod schemas
- регистрация, вход, выход и cookie session через Better Auth
- поиск пользователей только по username
- direct и group chats в одном списке
- история и отправка текстовых сообщений
- realtime-доставка сообщений через authenticated Socket.IO
- membership-проверки для chat/messages/voice endpoints
- постоянная LiveKit voice/video room внутри каждого чата
- mic/camera controls, local deafen и независимый leave
- voice presence в Valkey
- Tailwind CSS и PWA manifest/service worker
- Docker Compose для frontend, backend, PostgreSQL, Valkey, LiveKit и Caddy

## Требования

- Node.js 22+
- npm 10+
- Docker Desktop с Docker Compose

## Локальная разработка

```bash
copy .env.example .env
npm install
docker compose up -d postgres valkey
npm run db:generate
npm run db:migrate -- --name init
npm run dev
```

Frontend: `http://localhost:5173`  
API health: `http://localhost:3000/health`

При запуске через `npm run dev` в `.env` для API нужны локальные адреса PostgreSQL и Valkey:

```env
DATABASE_URL=postgresql://goida:change_me_database_password@localhost:55432/goida_chat?schema=public
VALKEY_URL=redis://localhost:56379
APP_URL=http://localhost:5173
BETTER_AUTH_URL=http://localhost:3000
LIVEKIT_URL=ws://localhost:7880
```

## Полный запуск в Docker

```bash
copy .env.example .env
docker compose up --build -d
docker compose exec backend npx prisma migrate deploy --schema services/api/prisma/schema.prisma
```

Приложение: `http://localhost`  
API: `http://localhost/health`  
Альтернативный API host: `http://api.localhost/health`  
LiveKit WebSocket: `ws://livekit.localhost`

Auth routes are mounted under `/auth`:

- `POST /auth/sign-up/email`
- `POST /auth/sign-in/email`
- `POST /auth/sign-out`
- `GET /auth/me`

Main API routes:

- `GET /users/search?username=`
- `GET /chats`
- `POST /chats/direct`
- `POST /chats/group`
- `GET /chats/:chatId/messages`
- `POST /chats/:chatId/messages`
- `POST /chats/:chatId/voice/token`
- `GET /chats/:chatId/voice/presence`

## Основные команды

```bash
npm run build
npm run typecheck
npm run lint
npm run format
npm run db:generate
npm run db:migrate -- --name init
```

## VPS helper scripts

```bash
bash scripts/vps-deploy.sh
bash scripts/vps-smoke-test.sh
bash scripts/vps-backup-postgres.sh
```

## Следующий этап

Production deploy описан в [`docs/VPS_DEPLOY.md`](docs/VPS_DEPLOY.md): VPS, DNS, HTTPS, firewall, secrets, migrations and backup. Для VPS используйте `.env.production.example` как стартовый шаблон вместо локального `.env.example`.

Не коммитьте `.env`: реальные секреты должны храниться только на машине разработчика и VPS.
