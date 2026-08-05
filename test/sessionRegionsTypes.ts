import { unsafe_createClientWithApiKey } from '../src';

const client = unsafe_createClientWithApiKey(
  'api-key',
  {
    personaId: 'persona-1',
    name: 'Cara',
    avatarId: 'avatar-1',
    voiceId: 'voice-1',
  },
);

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;
type ServedRegionIsOpen = Expect<
  Equal<ReturnType<typeof client.getActiveSessionRegion>, string | null>
>;
void (null as unknown as ServedRegionIsOpen);

const activeRegion = client.getActiveSessionRegion();
if (activeRegion !== null) {
  const servedRegion: string = activeRegion;
  void servedRegion;
}
