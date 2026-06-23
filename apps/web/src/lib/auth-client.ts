import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

const apiUrl =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);

export const authClient = createAuthClient({
  baseURL: apiUrl,
  basePath: '/auth',
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [usernameClient()],
});
