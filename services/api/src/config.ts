import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  VALKEY_URL: z.string().min(1).default('redis://localhost:6379'),
  COOKIE_SECRET: z.string().min(32),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  LIVEKIT_URL: z.string().url().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
});

export const env = envSchema.parse(process.env);

function assertProductionSafety() {
  if (env.NODE_ENV !== 'production') return;

  const insecureUrls = [
    ['APP_URL', env.APP_URL, 'https:'],
    ['BETTER_AUTH_URL', env.BETTER_AUTH_URL, 'https:'],
  ] as const;

  for (const [name, value, protocol] of insecureUrls) {
    if (new URL(value).protocol !== protocol) {
      throw new Error(`${name} must use ${protocol}// in production`);
    }
  }

  if (new URL(env.LIVEKIT_URL).protocol !== 'wss:') {
    throw new Error('LIVEKIT_URL must use wss:// in production');
  }

  const unsafeFragments = ['change_me', 'devkey', 'localhost', 'example.com'];
  const secretCandidates = {
    DATABASE_URL: env.DATABASE_URL,
    COOKIE_SECRET: env.COOKIE_SECRET,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    LIVEKIT_API_KEY: env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: env.LIVEKIT_API_SECRET,
  };

  for (const [name, value] of Object.entries(secretCandidates)) {
    if (unsafeFragments.some((fragment) => value.includes(fragment))) {
      throw new Error(
        `${name} contains a development placeholder and cannot be used in production`,
      );
    }
  }
}

assertProductionSafety();
