FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl python3 make g++

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/api/package.json services/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY services/api services/api
COPY packages/shared packages/shared
ENV DATABASE_URL=postgresql://goida:change_me_database_password@postgres:5432/goida_chat?schema=public
RUN npm run db:generate && npm run build -w @goida-chat/shared && npm run build -w @goida-chat/api

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/services/api/package.json ./services/api/package.json
COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=build /app/services/api/prisma ./services/api/prisma
COPY --from=build /app/packages/shared ./packages/shared

EXPOSE 3000
CMD ["node", "services/api/dist/server.js"]
