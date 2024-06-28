import { InternalEvent, InternalEventCallbacks } from '../types';

export class InternalEventEmitter {
  private listeners: {
    [K in InternalEvent]?: Set<InternalEventCallbacks[K]>;
  } = {};

  constructor() {}

  public addListener<K extends InternalEvent>(
    event: K,
    callback: InternalEventCallbacks[K],
  ): void {
    console.log('Adding INTERNAL listener', event, callback);
    if (!this.listeners[event]) {
      (this.listeners[event] as Set<InternalEventCallbacks[K]>) = new Set<
        InternalEventCallbacks[K]
      >();
    }
    (this.listeners[event] as Set<InternalEventCallbacks[K]>).add(callback);
  }

  public removeListener<K extends InternalEvent>(
    event: K,
    callback: InternalEventCallbacks[K],
  ): void {
    if (!this.listeners[event]) return;
    (this.listeners[event] as Set<InternalEventCallbacks[K]>).delete(callback);
  }

  public emit<K extends InternalEvent>(
    event: K,
    ...args: InternalEventCallbacks[K] extends (...args: infer P) => any
      ? P
      : never
  ): void {
    console.log('Emitting INTERNAL event', event, args);
    if (!this.listeners[event]) return;
    (this.listeners[event] as Set<InternalEventCallbacks[K]>).forEach(
      (callback) => {
        (callback as (...args: any[]) => void)(...args);
      },
    );
  }
}
