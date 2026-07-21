import type {
  DirectorNotes,
  RuntimeDirectorNotes,
} from '../src/types/directorNotes';

const preset: DirectorNotes = {
  presetStyle: 'warm',
  expressivity: 0,
};
const custom: DirectorNotes = { customStylePrompt: 'Stay composed.' };
const expressivityOnly: DirectorNotes = { expressivity: 1 };
const runtimePreset: RuntimeDirectorNotes = { presetStyle: null };
const runtimeExpressivity: RuntimeDirectorNotes = { expressivity: 0 };
const runtimeBoth: RuntimeDirectorNotes = {
  presetStyle: 'happy',
  expressivity: 0.5,
};

void [
  preset,
  custom,
  expressivityOnly,
  runtimePreset,
  runtimeExpressivity,
  runtimeBoth,
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

// Runtime updates must contain at least one field.
// @ts-expect-error
const invalidEmptyRuntimeUpdate: RuntimeDirectorNotes = {};

// Custom prompts are session-start-only and cannot be sent live.
const invalidRuntimeCustomPrompt: RuntimeDirectorNotes = {
  expressivity: 0.5,
  // @ts-expect-error
  customStylePrompt: 'Stay composed.',
};

void [
  invalidCuePreset,
  invalidMixedStyle,
  invalidEmptyRuntimeUpdate,
  invalidRuntimeCustomPrompt,
];
