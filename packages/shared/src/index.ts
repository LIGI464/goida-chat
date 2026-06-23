import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_]+$/, 'Use only lowercase Latin letters, numbers, and underscores');

export const passwordSchema = z.string().min(8).max(128);

export const signUpSchema = z.object({
  email: z.string().email(),
  username: usernameSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
});

export const messageInputSchema = z.object({
  chatId: z.string().cuid(),
  text: z.string().trim().min(1).max(4000),
});

export const createDirectChatSchema = z.object({ username: usernameSchema });

export const createGroupChatSchema = z.object({
  title: z.string().trim().min(1).max(100),
  memberUsernames: z.array(usernameSchema).max(99),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type MessageInput = z.infer<typeof messageInputSchema>;
