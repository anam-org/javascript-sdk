export type { AnamClientOptions } from './AnamClientOptions';
export type { ConnectionMilestoneMetricsOptions } from './ConnectionMilestoneMetricsOptions';
export type { TransparentBackgroundOptions } from './TransparentBackgroundOptions';
export type * from './signalling';
export { SignalMessageAction } from './signalling'; // need to export this explicitly to avoid enum import issues
export type * from './streaming';
export { DataChannelMessage } from './streaming';
export type * from './coreApi';
export type {
  PersonaConfig,
  PersonaConfigUpdateAppliedEvent,
} from './PersonaConfig';
export type { ApiGatewayConfig } from './ApiGatewayConfig';
export type { InputAudioState } from './InputAudioState';
export { AudioPermissionState } from './InputAudioState';
export type * from './messageHistory';
export { MessageRole } from './messageHistory'; // need to export this explicitly to avoid enum import issues
export type * from './events';
export { AnamEvent } from './events'; // need to export this explicitly to avoid enum import issues
export { InternalEvent } from './events'; // need to export this explicitly to avoid enum import issues
export { ConnectionClosedCode } from './events'; // need to export this explicitly to avoid enum import issues
export { AgentAudioInputStream } from './AgentAudioInputStream';
export type * from './toolCalling';
export type * from './directorNotes';
export { DIRECTOR_NOTE_CUE_TAGS } from './directorNotes';
