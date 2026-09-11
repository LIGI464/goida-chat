CREATE TABLE "ChatInvite" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatInvite_token_key" ON "ChatInvite"("token");
CREATE INDEX "ChatInvite_chatId_idx" ON "ChatInvite"("chatId");
CREATE INDEX "ChatInvite_expiresAt_idx" ON "ChatInvite"("expiresAt");
ALTER TABLE "ChatInvite" ADD CONSTRAINT "ChatInvite_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatInvite" ADD CONSTRAINT "ChatInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;