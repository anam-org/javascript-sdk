import type {
  DirectorNoteCueOptions,
  DirectorNoteCueTag,
  DirectorNotes,
} from '../src/types/directorNotes';
import { AnamEvent } from '../src/types/events';

const preset: DirectorNotes = {
  presetStyle: 'warm',
  expressivity: 0,
};
const custom: DirectorNotes = { customStylePrompt: 'Stay composed.' };
const expressivityOnly: DirectorNotes = { expressivity: 1 };
const immediateCue: DirectorNoteCueOptions = {};
const relativeCue: DirectorNoteCueOptions = { inSeconds: 0 };
const absoluteCue: DirectorNoteCueOptions = { atSeconds: 1.25 };
const cueOnlyTag: DirectorNoteCueTag = 'curious';
const dataChannelOpenEvent: AnamEvent = AnamEvent.DATA_CHANNEL_OPEN;

void [
  preset,
  custom,
  expressivityOnly,
  immediateCue,
  relativeCue,
  absoluteCue,
  cueOnlyTag,
  dataChannelOpenEvent,
];

// Cue-only tags are not valid public presets.
// @ts-expect-error
const invalidCuePreset: DirectorNotes = { presetStyle: 'curious' };

// A preset and custom prompt are mutually exclusive.
// @ts-expect-error
const invalidMixedStyle: DirectorNotes = {
  presetStyle: 'warm',
  customStylePrompt: 'Stay composed.',
};

// Cue timing modes are mutually exclusive.
// @ts-expect-error
const invalidCueTiming: DirectorNoteCueOptions = {
  inSeconds: 0,
  atSeconds: 1,
};

// Unknown runtime cue tags are rejected.
// @ts-expect-error
const invalidCueTag: DirectorNoteCueTag = 'rage';

void [invalidCuePreset, invalidMixedStyle, invalidCueTiming, invalidCueTag];
