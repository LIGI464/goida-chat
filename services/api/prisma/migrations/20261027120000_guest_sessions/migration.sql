CREATE TABLE "GuestSession" (
  "id" TEXT NOT NULL,
  "guestId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "inviteToken" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuestSession_guestId_key" ON "GuestSession"("guestId");
CREATE INDEX "GuestSession_chatId_expiresAt_idx" ON "GuestSession"("chatId", "expiresAt");
CREATE INDEX "GuestSession_expiresAt_idx" ON "GuestSession"("expiresAt");
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Message" ADD COLUMN "guestSessionId" TEXT;
ALTER TABLE "Message" ADD CONSTRAINT "Message_guestSessionId_fkey"
  FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Message_guestSessionId_idx" ON "Message"("guestSessionId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_one_author_check"
  CHECK (("userId" IS NOT NULL)::int + ("guestSessionId" IS NOT NULL)::int = 1);
