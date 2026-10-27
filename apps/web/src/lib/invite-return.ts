const KEY = 'goida.pending-invite';
const TOKEN = /^[a-zA-Z0-9_-]{16,256}$/u;

export function savePendingInvite(token: string) {
  if (!TOKEN.test(token)) { clearPendingInvite(); return; }
  try { sessionStorage.setItem(KEY, token); } catch { /* storage can be unavailable */ }
}

export function pendingInvitePath() {
  try {
    const token = sessionStorage.getItem(KEY);
    return token && TOKEN.test(token) ? `/invite/${encodeURIComponent(token)}` : null;
  } catch { return null; }
}

export function clearPendingInvite() {
  try { sessionStorage.removeItem(KEY); } catch { /* storage can be unavailable */ }
}
