import { Prisma } from '@prisma/client';
import { badRequest, gone, notFound } from '../lib/http.js';

// All entry points lock the same row before checking membership or consuming a
// use. READ COMMITTED re-reads after the lock, including concurrent revocation.
export async function lockInvite(tx: Prisma.TransactionClient, token: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ChatInvite" WHERE token = ${token} FOR UPDATE`);
  const invite = await tx.chatInvite.findUnique({
    where: { token },
    include: { chat: { select: { type: true } } },
  });
  if (!invite) throw notFound('Invite not found');
  if (invite.revokedAt) throw gone('Invite has been revoked');
  if (invite.expiresAt <= new Date()) throw gone('Invite has expired');
  if (invite.chat.type !== 'group') throw badRequest('Invites are available for group chats only');
  return invite;
}

export async function consumeInvite(
  tx: Prisma.TransactionClient,
  invite: Awaited<ReturnType<typeof lockInvite>>,
) {
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    throw gone('Invite has reached its usage limit');
  }
  await tx.chatInvite.update({ where: { id: invite.id }, data: { uses: { increment: 1 } } });
}
