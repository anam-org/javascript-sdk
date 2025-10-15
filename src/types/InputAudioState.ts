export enum AudioPermissionState {
  PENDING = 'pending',
  GRANTED = 'granted',
  DENIED = 'denied',
  NOT_REQUESTED = 'not_requested',
}

export interface InputAudioState {
  isMuted: boolean;
  permissionState: AudioPermissionState;
}
