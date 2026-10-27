import { useEffect, useState } from 'react';

export const VOICE_PEER_VOLUME_STORAGE_KEY = 'voice.peerVolume.v1';
export const DEFAULT_VOICE_PEER_VOLUME = 100;
export const MIN_VOICE_PEER_VOLUME = 0;
export const MAX_VOICE_PEER_VOLUME = 200;

type PersistedPeerVolumes = Record<string, Record<string, number>>;

export interface VoicePeerVolumeRepository {
  getVolume(selfUserId: string, remoteUserId: string): number | null;
  getVolumesForUser(selfUserId: string): Record<string, number>;
  setVolume(selfUserId: string, remoteUserId: string, nextVolume: number): Record<string, number>;
}

const isBrowser = typeof window !== 'undefined';

function clampPeerVolume(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_VOICE_PEER_VOLUME;

  return Math.min(MAX_VOICE_PEER_VOLUME, Math.max(MIN_VOICE_PEER_VOLUME, Math.round(value)));
}

function normalizeUserVolumes(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([remoteUserId, rawVolume]) => {
      if (typeof remoteUserId !== 'string' || !remoteUserId) {
        return [];
      }

      if (typeof rawVolume !== 'number' || !Number.isFinite(rawVolume)) {
        return [];
      }

      return [[remoteUserId, clampPeerVolume(rawVolume)]];
    }),
  );
}

function normalizePersistedPeerVolumes(value: unknown): PersistedPeerVolumes {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([selfUserId, rawVolumes]) => {
      if (typeof selfUserId !== 'string' || !selfUserId) {
        return [];
      }

      return [[selfUserId, normalizeUserVolumes(rawVolumes)]];
    }),
  );
}

function readPersistedPeerVolumes(storage: Storage | null): PersistedPeerVolumes {
  if (!storage) return {};

  try {
    const raw = storage.getItem(VOICE_PEER_VOLUME_STORAGE_KEY);
    if (!raw) return {};

    return normalizePersistedPeerVolumes(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writePersistedPeerVolumes(storage: Storage | null, volumes: PersistedPeerVolumes) {
  if (!storage) return;

  try {
    storage.setItem(VOICE_PEER_VOLUME_STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    // Ignore storage write failures and keep the in-memory value.
  }
}

export function createVoicePeerVolumeRepository(
  storage: Storage | null = isBrowser ? window.localStorage : null,
): VoicePeerVolumeRepository {
  return {
    getVolume(selfUserId, remoteUserId) {
      if (!selfUserId || !remoteUserId) return null;

      return readPersistedPeerVolumes(storage)[selfUserId]?.[remoteUserId] ?? null;
    },
    getVolumesForUser(selfUserId) {
      if (!selfUserId) return {};

      return readPersistedPeerVolumes(storage)[selfUserId] ?? {};
    },
    setVolume(selfUserId, remoteUserId, nextVolume) {
      if (!selfUserId || !remoteUserId) return {};

      const persisted = readPersistedPeerVolumes(storage);
      const nextUserVolumes = {
        ...(persisted[selfUserId] ?? {}),
        [remoteUserId]: clampPeerVolume(nextVolume),
      };
      const nextPersisted = {
        ...persisted,
        [selfUserId]: nextUserVolumes,
      };

      writePersistedPeerVolumes(storage, nextPersisted);
      return nextUserVolumes;
    },
  };
}

export const voicePeerVolumeRepository = createVoicePeerVolumeRepository();

export function usePersistentPeerVolumes(
  selfUserId: string | null | undefined,
  repository: VoicePeerVolumeRepository = voicePeerVolumeRepository,
) {
  const [remoteParticipantVolumes, setRemoteParticipantVolumes] = useState<Record<string, number>>(
    () => (selfUserId ? repository.getVolumesForUser(selfUserId) : {}),
  );

  useEffect(() => {
    setRemoteParticipantVolumes(selfUserId ? repository.getVolumesForUser(selfUserId) : {});
  }, [repository, selfUserId]);

  function setRemoteParticipantVolume(remoteUserId: string, nextVolume: number) {
    if (!selfUserId || !remoteUserId) return;

    setRemoteParticipantVolumes(repository.setVolume(selfUserId, remoteUserId, nextVolume));
  }

  return {
    remoteParticipantVolumes,
    setRemoteParticipantVolume,
  };
}
