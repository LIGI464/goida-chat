# Scoped guest access

Apply `npm run db:deploy` and regenerate the Prisma client before starting this version.

`POST /auth/guest/start` accepts `{ "token": "<invite token>" }`. It validates the existing
group invite and creates a `GuestSession`, never a Better Auth `User`. The response uses
the authorization principal below, and the server sets a signed, host-only HttpOnly cookie
(`Secure` in production, `SameSite=Lax`). An active session for the same invite is reused
without extending its expiry. A new invite replaces and revokes the previous guest session.

Sessions expire after two hours or when the invite expires, whichever is earlier. Guests
can read and send messages, type and join voice only in `principal.chatId`. They cannot
search accounts, create rooms, manage members, rename rooms, create invitations or delete
rooms. Existing invite routes remain account-only and unchanged.

## Authorization contract for integration

`lib/principal.ts` exports `AuthorizationPrincipal`, a discriminated union:

- `kind: 'user'`: the Better Auth `user` and `session`, plus `id`.
- `kind: 'guest'`: a random `guest_` ID, public `user` with `email: null`, `session`,
  `chatId` and `inviteToken`. Never use this ID in a `User` foreign key.

`requirePrincipal(request)` and `getAuthorizationPrincipal(headers)` resolve the same
principal for HTTP and Socket.IO. Account sessions take precedence over guest cookies.
`ensurePrincipalChatAccess(principal, chatId)` enforces scope and session validity;
`requireUserPrincipal(principal)` is available for account-only integrations. The existing
`requireSession` deliberately continues to require a Better Auth account for invite routes
and account management.

Guest messages reference `GuestSession` separately. The database check requires exactly
one message author. Public message serialization preserves the existing `userId`/`user`
shape for both kinds of author. Signing out expires the guest row rather than deleting it,
so historical message authors remain readable.

The public invite access gate preserves the token in session storage and auth navigation
state, presents login/registration/guest choices and returns to the invited room. It wraps
the existing invite page; guest entry uses its own session endpoint.

## Limits and expiry

Redis counters are shared across tabs, reconnects and API instances: 20 entry attempts and
5 new sessions per IP per hour, 60 HTTP requests and 60 socket events per guest per minute,
10 socket connections and 10 messages per guest per minute. The message counter covers both
HTTP and Socket.IO. Creation is also limited to 5 attempts per IP per minute by Fastify.
Guest sessions cannot create any rooms.

Every guest socket packet checks the live session and room scope. At expiry the socket
disconnects. Voice JWTs use the same identity and room and cannot outlive the session.
Because JWT expiry does not end an established LiveKit call, voice token issuance also
adds a persistent Redis expiry entry. API timers remove expired participants and retry
cleanup every 5 seconds, including after restart and for clients without Socket.IO.
Signing out revokes the row, disconnects its sockets and requests voice removal immediately.

## Verification

`npm run test:guest -w @goida-chat/api` exercises real HTTP and Socket.IO handlers with
in-memory database, Redis and LiveKit fixtures. It covers cookie tampering, room isolation,
forbidden management, messages, shared limits, presence, JWT claims, sign-out and active
socket expiry. Run `npm run lint`, `npm run typecheck` and `npm run build` as well.
