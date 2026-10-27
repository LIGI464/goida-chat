import { createWriteStream } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AttachmentValidator } from './validation.js';
import { badRequest } from '../lib/http.js';

export interface StorageAdapter {
  put(key: string, source: Readable, mimeType: string, signal?: AbortSignal): Promise<number>;
  read(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

export class FilesystemStorageAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}

  private path(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key');
    return resolve(this.root, key);
  }

  async put(key: string, source: Readable, mimeType: string, signal?: AbortSignal) {
    const target = this.path(key);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // A malformed multipart stream may already have closed while awaiting I/O.
    // pipeline cannot observe an earlier close event on a destroyed source.
    if (source.destroyed) throw badRequest('Загрузка прервана или multipart повреждён');
    const validator = new AttachmentValidator(mimeType);
    // No buffering: backpressure propagates through validation to multipart.
    try {
      await pipeline(source, validator, createWriteStream(target, { flags: 'wx', mode: 0o600 }), {
        signal,
      });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        (error instanceof Error &&
          /terminated early|Unexpected end of multipart/.test(error.message))
      )
        throw badRequest('Загрузка прервана или multipart повреждён');
      throw error;
    }
    return validator.size;
  }

  async read(key: string) {
    const handle = await open(this.path(key), 'r');
    return handle.createReadStream();
  }

  async remove(key: string) {
    try {
      await unlink(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
