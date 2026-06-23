# Goida Chat

Минимальный приватный web/PWA-чат с постоянной voice/video-комнатой в каждом чате.

## Что уже есть в основе

- npm workspaces monorepo: React frontend, Fastify API, shared Zod schemas
- PostgreSQL + Prisma models
- Socket.IO и заготовки LiveKit/Valkey
- Tailwind CSS и PWA manifest/service worker
- Docker Compose для frontend, backend, PostgreSQL, Valkey, LiveKit и Caddy
- Better Auth email/password auth with username support

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

## Основные команды

```bash
npm run build
npm run typecheck
npm run lint
npm run format
npm run db:generate
npm run db:migrate -- --name init
```

## Следующие этапы

1. поиск пользователей и создание чатов
2. история сообщений и realtime Socket.IO events
3. LiveKit token endpoint и voice presence
4. production Caddy/LiveKit TURN-конфигурация и backup PostgreSQL

Не коммитьте `.env`: реальные секреты должны храниться только на машине разработчика и VPS.
