/* global process, console, URL */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

// This command never reads the project's .env or a production database.
const base = new URL(process.env.RELEASE_TEST_DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(base.hostname) || base.port !== '55433') {
  throw new Error('Use the isolated release-test PostgreSQL on localhost:55433');
}
const admin = new PrismaClient({ datasourceUrl: base.href });
const schema = resolve('services/api/prisma/schema.prisma');
const cli = resolve('node_modules/prisma/build/index.js');
const scratch = await mkdtemp(resolve('.tmp/release-migrations-'));
const names = ['release_clean', 'release_upgrade'].map((name) => `${name}_${Date.now()}`);
function run(args, url) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
}
try {
  await mkdir(resolve(scratch, 'migrations'), { recursive: true });
  await cp(schema, resolve(scratch, 'schema.prisma'));
  for (const name of ['20260623174750_init', '20260623190312_auth', 'migration_lock.toml']) {
    await cp(
      resolve('services/api/prisma/migrations', name),
      resolve(scratch, 'migrations', name),
      { recursive: true },
    );
  }
  for (const [index, name] of names.entries()) {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    const db = new PrismaClient({ datasourceUrl: url.href });
    try {
      if (index === 1) {
        run(['migrate', 'deploy', '--schema', resolve(scratch, 'schema.prisma')], url.href);
        await db.$executeRawUnsafe(
          `INSERT INTO "User" (id,email,username,"updatedAt") VALUES ('migration-user','migration@example.test','migration_user',now())`,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO "Chat" (id,type,title,"updatedAt") VALUES ('migration-room','group','Synthetic upgrade fixture',now())`,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO "ChatMember" (id,"chatId","userId") VALUES ('migration-member','migration-room','migration-user')`,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO "Message" (id,"chatId","userId",text) VALUES ('migration-message','migration-room','migration-user','Synthetic migration sentinel')`,
        );
      }
      run(['migrate', 'deploy', '--schema', schema], url.href);
      run(['migrate', 'status', '--schema', schema], url.href);
      run(
        ['migrate', 'diff', '--from-url', url.href, '--to-schema-datamodel', schema, '--exit-code'],
        url.href,
      );
      const applied = await db.$queryRawUnsafe(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
      );
      assert.equal(applied.length, 7);
      if (index === 1) {
        const message = await db.message.findUnique({ where: { id: 'migration-message' } });
        assert.equal(message.text, 'Synthetic migration sentinel');
        assert.equal(await db.chatMember.count(), 1);
      }
      console.log(
        `${index === 0 ? 'Clean database' : 'Previous production schema + synthetic data'}: 7 migrations, schema diff empty, PASS`,
      );
    } finally {
      await db.$disconnect();
    }
  }
} finally {
  await admin.$disconnect();
}
