import { Transform, type TransformCallback } from 'node:stream';
import { extname } from 'node:path';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '@goida-chat/shared';
import { badRequest, HttpError } from '../lib/http.js';

const forbiddenPart =
  /\.(exe|com|bat|cmd|msi|dll|scr|ps1|sh|bash|js|mjs|cjs|vbs|jar|hta|lnk|app|dmg|deb|rpm|apk|html?|svg)(\.|$)/i;

export function validateFileMetadata(originalName: string, declaredMime: string) {
  if (
    !originalName ||
    originalName.length > 180 ||
    // eslint-disable-next-line no-control-regex -- reject control bytes in filenames
    /[\x00-\x1f\x7f/\\:<>"|?*\u202a-\u202e\u2066-\u2069]/.test(originalName) ||
    originalName !== originalName.trim() ||
    forbiddenPart.test(originalName)
  ) {
    throw badRequest('Недопустимое имя или исполняемый тип файла');
  }
  const extension = extname(originalName).toLowerCase();
  const mimeType = ATTACHMENT_TYPES[extension];
  // Browsers may omit the type of a known extension. Infer it only for generic
  // headers, and still verify the bytes below before publishing the message.
  if (
    !mimeType ||
    ![mimeType, 'application/octet-stream', 'audio/x-wav'].includes(declaredMime) ||
    (declaredMime === 'audio/x-wav' && mimeType !== 'audio/wav')
  ) {
    throw badRequest('Тип файла не поддерживается или не соответствует расширению');
  }
  return { originalName, mimeType };
}

function verifyHeader(bytes: Buffer, mime: string) {
  const ascii = bytes.toString('latin1');
  const hex = bytes.subarray(0, 4).toString('hex');
  if (
    /^(MZ|\x7fELF|#!)/.test(ascii) ||
    ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(hex)
  ) {
    throw badRequest('Исполняемые файлы запрещены');
  }
  const valid =
    mime === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : mime === 'image/jpeg'
        ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        : mime === 'image/gif'
          ? /^GIF8[79]a/.test(ascii)
          : mime === 'image/webp'
            ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
            : mime === 'application/pdf'
              ? ascii.startsWith('%PDF-')
              : mime === 'audio/wav'
                ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE'
                : mime === 'audio/mpeg'
                  ? ascii.startsWith('ID3') ||
                    (bytes[0] === 255 && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
                  : mime === 'video/mp4'
                    ? ascii.slice(4, 8) === 'ftyp' &&
                      /^(isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(ascii.slice(8, 12))
                    : !/^\s*<(?:!doctype|html|script|svg|\?xml)/i.test(ascii);
  if (!valid) throw badRequest('Содержимое файла не соответствует его типу');
}

export class AttachmentValidator extends Transform {
  size = 0;
  private header = Buffer.alloc(0);
  private verified = false;
  private readonly decoder: TextDecoder | null;

  constructor(
    private readonly mimeType: string,
    private readonly limit = MAX_ATTACHMENT_BYTES,
  ) {
    super();
    this.decoder = ['text/plain', 'text/csv', 'application/json'].includes(mimeType)
      ? new TextDecoder('utf-8', { fatal: true })
      : null;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    try {
      this.size += chunk.length;
      if (this.size > this.limit)
        throw new HttpError(413, 'Размер файла не должен превышать 100 МБ');
      if (this.decoder) {
        // eslint-disable-next-line no-control-regex -- reject binary bytes in text uploads
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(this.decoder.decode(chunk, { stream: true })))
          throw badRequest('Ожидается текстовый файл UTF-8');
      }
      if (!this.verified) {
        const needed = Math.min(512 - this.header.length, chunk.length);
        this.header = Buffer.concat([this.header, chunk.subarray(0, needed)]);
        if (this.header.length === 512) {
          verifyHeader(this.header, this.mimeType);
          this.verified = true;
        }
      }
      callback(null, chunk);
    } catch (error) {
      callback(error instanceof HttpError ? error : badRequest('Некорректное содержимое файла'));
    }
  }

  override _flush(callback: TransformCallback) {
    try {
      if (this.size === 0) throw badRequest('Пустой файл нельзя отправить');
      this.decoder?.decode();
      if (!this.verified) verifyHeader(this.header, this.mimeType);
      callback();
    } catch (error) {
      callback(error instanceof HttpError ? error : badRequest('Некорректное содержимое файла'));
    }
  }
}
