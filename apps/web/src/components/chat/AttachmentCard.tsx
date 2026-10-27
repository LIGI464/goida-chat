import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ATTACHMENT_EXPIRED_MESSAGE } from '@goida-chat/shared';
import { api, ApiError, apiUrl, type Attachment } from '../../lib/api';

export function formatFileSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} МБ`
    : `${Math.max(1, Math.ceil(size / 1024))} КБ`;
}

export function AttachmentCard({ attachment, chatId }: { attachment: Attachment; chatId: string }) {
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<Error | null>(null);
  const [downloading, setDownloading] = useState(false);
  const expired =
    attachment.status === 'expired' ||
    new Date(attachment.expiresAt).getTime() <= now ||
    (error instanceof ApiError && error.status === 410);
  useEffect(() => {
    if (expired) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(new Date(attachment.expiresAt).getTime() - Date.now(), 2_147_483_647)),
    );
    return () => clearTimeout(timer);
  }, [expired, attachment.expiresAt, now]);
  const image = attachment.mimeType.startsWith('image/');
  const preview = useQuery({
    queryKey: ['attachmentPreview', chatId, attachment.id],
    queryFn: () => api.attachmentUrl(chatId, attachment.id, 'preview'),
    enabled: image && !expired,
    refetchInterval: 4 * 60 * 1000,
    refetchOnMount: 'always',
    retry: false,
  });

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      // Fetch a new short-lived URL for every click, even in an old chat tab.
      const { url } = await api.attachmentUrl(chatId, attachment.id, 'download');
      const link = document.createElement('a');
      link.href = `${apiUrl}${url}`;
      link.download = attachment.originalName;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      document.body.append(link);
      link.click();
      link.remove();
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Не удалось скачать файл'));
    } finally {
      setDownloading(false);
    }
  }

  if (expired || (preview.error instanceof ApiError && preview.error.status === 410)) {
    return <p className="mt-2 text-sm text-[var(--muted)]">{ATTACHMENT_EXPIRED_MESSAGE}</p>;
  }
  return (
    <div className="brand-surface-muted mt-2 grid max-w-lg gap-2 rounded-xl p-3">
      {image && preview.data && !preview.isError && (
        <img
          className="max-h-72 max-w-full rounded-lg object-contain"
          src={`${apiUrl}${preview.data.url}`}
          alt={attachment.originalName}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      {image && preview.isPending && (
        <p className="text-xs text-[var(--muted)]">Загружаем изображение…</p>
      )}
      {image && preview.isError && (
        <button
          className="text-left text-xs text-[var(--muted)]"
          onClick={() => void preview.refetch()}
          type="button"
        >
          Предпросмотр недоступен. Повторить
        </button>
      )}
      <p className="break-words text-sm [overflow-wrap:anywhere]">{attachment.originalName}</p>
      <p className="break-all text-xs text-[var(--muted)]">
        {attachment.mimeType} · {formatFileSize(attachment.size)}
      </p>
      <button
        type="button"
        className="brand-button brand-button-secondary h-9 justify-self-start px-3 text-sm"
        disabled={downloading}
        onClick={() => void download()}
      >
        {downloading ? 'Подготовка…' : 'Скачать'}
      </button>
      <p className="text-xs text-[var(--muted)]">
        Доступно до {new Date(attachment.expiresAt).toLocaleString('ru-RU')}
      </p>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error.message}
        </p>
      )}
    </div>
  );
}
