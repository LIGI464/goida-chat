import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      name: 'Demo User',
      username: 'demo_user',
      displayUsername: 'demo_user',
      displayName: 'Demo User',
    },
  });
}

main().finally(async () => prisma.$disconnect());
