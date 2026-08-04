import { unsafe_createClientWithApiKey } from '../src';

const client = unsafe_createClientWithApiKey(
  'api-key',
  {
    personaId: 'persona-1',
    name: 'Cara',
    avatarId: 'avatar-1',
    voiceId: 'voice-1',
  },
  {
    sessionRegion: {
      region: 'us',
      regionPolicy: 'preferred',
    },
  },
);

const servedRegion: 'eu' | 'us' | null = client.getActiveSessionRegion();
void servedRegion;
