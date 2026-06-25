import { prisma } from '../src/lib/prisma.js';
import { valkey } from '../src/lib/valkey.js';

async function main() {
  const chats = await prisma.chat.findMany({
    select: { id: true },
  });

  const chatIds = chats.map((chat) => chat.id);
  const deleted = await prisma.chat.deleteMany({});

  const keys = [
    ...chatIds.map((chatId) => `presence:chat:${chatId}:typing`),
    ...chatIds.map((chatId) => `voice:chat:${chatId}:users`),
  ];

  if (keys.length > 0) {
    await valkey.del(...keys);
  }

  console.log(`Deleted ${deleted.count} chats`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    valkey.disconnect();
  });
