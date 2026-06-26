import { VideoTrack } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-core';
import type { Participant } from 'livekit-client';

function initials(value: string) {
  const parts = value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return '?';

  return parts.map((part) => part[0]!.toUpperCase()).join('');
}

type CameraTrackReference = Extract<TrackReferenceOrPlaceholder, { publication: unknown }>;

function isTrackReference(
  trackRef: TrackReferenceOrPlaceholder | null | undefined,
): trackRef is CameraTrackReference {
  return Boolean(trackRef && 'publication' in trackRef && trackRef.publication);
}

export function ParticipantTile({
  participant,
  displayName,
  trackRef,
  compact = false,
}: {
  participant: Participant;
  displayName: string;
  trackRef?: TrackReferenceOrPlaceholder | undefined;
  compact?: boolean | undefined;
}) {
  const hasCamera = participant.isCameraEnabled && isTrackReference(trackRef);
  const singleTileClasses = compact ? 'mx-auto w-full max-w-[420px]' : '';

  return (
    <article
      className={`group relative h-full overflow-hidden rounded-3xl border bg-[var(--panel-2)] shadow-[0_20px_50px_rgba(0,0,0,0.22)] transition-all ${
        participant.isSpeaking
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/35'
          : 'border-[var(--border)]'
      } ${singleTileClasses}`}
    >
      <div className="relative aspect-video bg-[#0a101a]">
        {hasCamera ? (
          <VideoTrack
            className="h-full w-full object-cover"
            manageSubscription={false}
            trackRef={trackRef}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_top,rgba(109,93,252,0.22),transparent_38%),linear-gradient(180deg,rgba(21,30,46,0.96),rgba(10,16,26,0.96))]">
            <div className="grid h-20 w-20 place-items-center rounded-full bg-[var(--accent)] text-2xl font-semibold text-white shadow-lg">
              {initials(displayName)}
            </div>
            <span className="text-sm text-[var(--muted)]">
              {participant.isLocal ? 'Твоя камера выключена' : 'Камера выключена'}
            </span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/75 via-black/20 to-transparent p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {displayName}
              {participant.isLocal ? ' / Ты' : ''}
            </p>
            <p className="text-xs text-white/70">
              {participant.isSpeaking ? 'Говорит' : 'В эфире'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!participant.isMicrophoneEnabled && (
              <span className="rounded-full bg-black/60 px-2 py-1 text-[11px] text-red-200">
                Микрофон выкл
              </span>
            )}
            {!participant.isCameraEnabled && (
              <span className="rounded-full bg-black/60 px-2 py-1 text-[11px] text-white/80">
                Камера выкл
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
