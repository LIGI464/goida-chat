DROP INDEX IF EXISTS "Message_chatId_createdAt_idx";
CREATE INDEX "Message_chatId_createdAt_id_idx" ON "Message"("chatId", "createdAt", "id");
