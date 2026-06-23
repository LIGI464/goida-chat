import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { username } from 'better-auth/plugins';

import { env } from './config.js';
import { prisma } from './lib/prisma.js';

export const auth = betterAuth({
  appName: 'Goida Chat',
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-up/email': { window: 60, max: 5 },
      '/sign-in/email': { window: 60, max: 10 },
    },
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
    cookiePrefix: 'goida-chat',
    defaultCookieAttributes: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    },
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 24,
      usernameValidator: (value) => /^[a-z0-9_]+$/.test(value),
      usernameNormalization: (value) => value.trim().toLowerCase(),
      displayUsernameNormalization: (value) => value.trim().toLowerCase(),
      validationOrder: {
        username: 'post-normalization',
        displayUsername: 'post-normalization',
      },
    }),
  ],
});
