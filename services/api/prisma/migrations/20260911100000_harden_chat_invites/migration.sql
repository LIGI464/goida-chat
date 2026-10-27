UPDATE "ChatInvite"
SET "expiresAt" = COALESCE("expiresAt", "createdAt" + INTERVAL '7 days')
WHERE "expiresAt" IS NULL;

ALTER TABLE "ChatInvite"
  ALTER COLUMN "expiresAt" SET NOT NULL,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "maxUses" INTEGER,
  ADD COLUMN "uses" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ChatInvite_chatId_revokedAt_idx" ON "ChatInvite"("chatId", "revokedAt");
