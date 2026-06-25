import { useEffect, useMemo, useState } from 'react';
import { Room } from 'livekit-client';

import {
  DEFAULT_VOICE_CAPTURE_PREFERENCES,
  readVoiceCapturePreferences,
  writeVoiceCapturePreferences,
} from './audioConstraints';

function fallbackDeviceId(devices: MediaDeviceInfo[]) {
  return (
    devices.find((device) => device.deviceId === 'default')?.deviceId ??
    devices[0]?.deviceId ??
    'default'
  );
}

export function useAudioDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState(() => readVoiceCapturePreferences().micDeviceId);

  const activeDeviceId = useMemo(() => {
    if (devices.length === 0) return micDeviceId;

    const found = devices.some((device) => device.deviceId === micDeviceId);
    return found ? micDeviceId : fallbackDeviceId(devices);
  }, [devices, micDeviceId]);

  useEffect(() => {
    writeVoiceCapturePreferences({ micDeviceId: activeDeviceId }, readVoiceCapturePreferences());
  }, [activeDeviceId]);

  useEffect(() => {
    let mounted = true;

    const refreshDevices = async () => {
      try {
        const next = await Room.getLocalDevices('audioinput', true);
        if (!mounted) return;

        setDevices(next);
      } catch {
        if (mounted) setDevices([]);
      }
    };

    void refreshDevices();

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

    return () => {
      mounted = false;
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, []);

  useEffect(() => {
    if (devices.length === 0) return;

    const hasSelection = devices.some((device) => device.deviceId === micDeviceId);
    if (!hasSelection) {
      setMicDeviceId(DEFAULT_VOICE_CAPTURE_PREFERENCES.micDeviceId);
    }
  }, [devices, micDeviceId]);

  const updateMicDeviceId = (deviceId: string) => {
    setMicDeviceId(deviceId);
    writeVoiceCapturePreferences({ micDeviceId: deviceId }, readVoiceCapturePreferences());
  };

  return {
    activeDeviceId,
    devices,
    setMicDeviceId: updateMicDeviceId,
  };
}
