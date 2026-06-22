import { describe, expect, it } from 'vitest';
import { buildRTCConfiguration } from '../src/lib/SessionConfig';

describe('buildRTCConfiguration', () => {
  const fallbackIceServers: RTCIceServer[] = [
    { urls: ['turns:default.example.com:443?transport=tcp'] },
  ];
  const serverIceServers: RTCIceServer[] = [
    { urls: ['turn:relay.example.com:3478?transport=udp'] },
  ];

  it('uses resolved ice servers and preserves caller transport policy when session config is absent', () => {
    const configuration = buildRTCConfiguration(
      {
        iceServers: [{ urls: ['turns:caller.example.com:443?transport=tcp'] }],
        iceTransportPolicy: 'relay',
        bundlePolicy: 'max-bundle',
      },
      fallbackIceServers,
    );

    expect(configuration).toEqual({
      iceServers: fallbackIceServers,
      iceTransportPolicy: 'relay',
      bundlePolicy: 'max-bundle',
    });
  });

  it('applies relay session config from the server', () => {
    const configuration = buildRTCConfiguration(
      { iceTransportPolicy: 'all' },
      fallbackIceServers,
      {
        iceServers: serverIceServers,
        iceTransportPolicy: 'relay',
        policy: 'relay-only',
      },
    );

    expect(configuration.iceServers).toEqual(serverIceServers);
    expect(configuration.iceTransportPolicy).toBe('relay');
  });

  it('applies all session config from the server', () => {
    const configuration = buildRTCConfiguration(
      { iceTransportPolicy: 'relay' },
      fallbackIceServers,
      {
        iceServers: serverIceServers,
        iceTransportPolicy: 'all',
        policy: 'default',
      },
    );

    expect(configuration.iceServers).toEqual(serverIceServers);
    expect(configuration.iceTransportPolicy).toBe('all');
  });

  it('lets server config win over caller ice servers and transport policy', () => {
    const configuration = buildRTCConfiguration(
      {
        iceServers: [{ urls: ['turns:caller.example.com:443?transport=tcp'] }],
        iceTransportPolicy: 'all',
      },
      fallbackIceServers,
      {
        iceServers: serverIceServers,
        iceTransportPolicy: 'relay',
        policy: 'tls-only',
      },
    );

    expect(configuration).toMatchObject({
      iceServers: serverIceServers,
      iceTransportPolicy: 'relay',
    });
  });
});
