import {
  ControlBar,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackLoop,
  useTracks,
} from '@livekit/components-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Track } from 'livekit-client';
import { useEffect, useState } from 'react';

import { api, type Chat, type PublicUser, type VoiceToken } from '../lib/api';
import type { ChatSocket } from '../lib/socket';

function VideoTiles() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);

  return (
    <div className="grid max-h-80 grid-cols-1 gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
      <TrackLoop tracks={tracks}>
        <ParticipantTile className="min-h-36 overflow-hidden rounded-xl bg-gray-950" />
      </TrackLoop>
    </div>
  );
}

export function VoicePanel({ chat, socket }: { chat: Chat; socket: ChatSocket | null }) {
  const queryClient = useQueryClient();
  const [voice, setVoice] = useState<VoiceToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deafened, setDeafened] = useState(false);
  const presenceQuery = useQuery({
    queryKey: ['voicePresence', chat.id],
    queryFn: () => api.getVoicePresence(chat.id),
  });

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { chatId: string; users: PublicUser[] }) => {
      if (payload.chatId !== chat.id) return;
      queryClient.setQueryData(['voicePresence', chat.id], { users: payload.users });
    };
    socket.on('voice:presence:update', handler);
    return () => {
      socket.off('voice:presence:update', handler);
    };
  }, [chat.id, queryClient, socket]);

  async function joinVoice() {
    setError(null);
    try {
      const token = await api.getVoiceToken(chat.id);
      setVoice(token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти в звонок');
    }
  }

  function markJoined() {
    socket?.emit('voice:join', { chatId: chat.id });
  }

  function leaveVoice() {
    socket?.emit('voice:left', { chatId: chat.id });
    setVoice(null);
  }

  const users = presenceQuery.data?.users ?? [];

  if (!voice) {
    return (
      <div className="border-b border-gray-800 bg-gray-950/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-400">В voice сейчас: {users.length}</p>
            {users.length > 0 && (
              <p className="text-xs text-gray-500">
                {users.map((user) => `@${user.username ?? user.name}`).join(', ')}
              </p>
            )}
          </div>
          <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm" onClick={joinVoice}>
            Войти в звонок
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border-b border-gray-800 bg-gray-900 px-4 py-3">
      <LiveKitRoom
        audio
        connect
        onConnected={markJoined}
        onDisconnected={leaveVoice}
        serverUrl={voice.url}
        token={voice.token}
        video={false}
      >
        {!deafened && <RoomAudioRenderer />}
        <VideoTiles />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="rounded-lg bg-gray-800 px-3 py-2 text-sm hover:bg-gray-700"
            onClick={() => setDeafened((value) => !value)}
            type="button"
          >
            {deafened ? 'Включить звук' : 'Заглушить звук'}
          </button>
          <ControlBar
            className="flex flex-wrap gap-2"
            controls={{
              microphone: true,
              camera: true,
              chat: false,
              screenShare: false,
              leave: true,
              settings: false,
            }}
            variation="textOnly"
          />
        </div>
      </LiveKitRoom>
    </div>
  );
}
