import { VideoTrack } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-core';
import type { Participant } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';

function isTrackReference(
  trackRef: TrackReferenceOrPlaceholder | null | undefined,
): trackRef is Extract<TrackReferenceOrPlaceholder, { publication: unknown }> {
  return Boolean(trackRef && 'publication' in trackRef && trackRef.publication);
}

export function ScreenShareTile({
  participant,
  displayName,
  trackRef,
}: {
  participant: Participant;
  displayName: string;
  trackRef?: TrackReferenceOrPlaceholder;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const fullscreenSupported = typeof document !== 'undefined' && document.fullscreenEnabled;
  const hasTrack = isTrackReference(trackRef);

  useEffect(() => {
    const container = containerRef.current;
    const handleFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (container && document.fullscreenElement === container) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  if (!hasTrack) return null;

  const label = participant.isLocal ? `${displayName} / Ты` : displayName;

  async function toggleFullscreen() {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else {
        await containerRef.current?.requestFullscreen();
      }
    } catch {
      setFullscreenError('Браузер не разрешил полноэкранный режим. Попробуй ещё раз.');
    }
  }

  return (
    <article
      className={`group relative overflow-hidden rounded-3xl border border-cyan-200/25 bg-[#07111b] shadow-[0_20px_50px_rgba(0,0,0,0.22)] ${
        fullscreen ? 'h-full w-full rounded-none' : ''
      }`}
      ref={containerRef}
    >
      <div className={`relative bg-[#050b12] ${fullscreen ? 'h-full' : 'aspect-video'}`}>
        <VideoTrack
          className="h-full w-full object-contain"
          manageSubscription={false}
          trackRef={trackRef}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/80 via-black/25 to-transparent p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{label}</p>
            <p className="text-xs text-cyan-100/75">Демонстрация экрана</p>
          </div>
          <button
            disabled={!fullscreenSupported}
            aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'Открыть на весь экран'}
            className="rounded-xl border border-white/20 bg-black/55 px-3 py-2 text-xs font-semibold text-white transition hover:bg-black/75 disabled:opacity-50"
            onClick={() => void toggleFullscreen()}
            type="button"
          >
            {!fullscreenSupported
              ? 'Fullscreen недоступен'
              : fullscreen
                ? 'Свернуть'
                : 'На весь экран'}
          </button>
        </div>
        {fullscreenError && (
          <p
            className="absolute inset-x-0 top-0 bg-black/80 p-3 text-xs text-amber-200"
            role="status"
          >
            {fullscreenError}
          </p>
        )}
      </div>
    </article>
  );
}
