export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const ATTACHMENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const ATTACHMENT_EXPIRED_MESSAGE = 'Срок хранения вложения истёк.';

// Explicit pairs: filenames and client MIME headers must agree. Active formats
// (SVG/HTML/scripts), executables and containers/archives are not accepted.
export const ATTACHMENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES).join(',');
