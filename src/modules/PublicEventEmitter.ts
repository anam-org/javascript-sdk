import { AnamEvent, EventCallbacks } from '../types';

export class PublicEventEmitter {
  private listeners: {
    [K in AnamEvent]?: Set<EventCallbacks[K]>;
  } = {};

  constructor() {}

  public addListener<K extends AnamEvent>(
    event: K,
    callback: EventCallbacks[K],
  ): void {
    if (!this.listeners[event]) {
      (this.listeners[event] as Set<EventCallbacks[K]>) = new Set<
        EventCallbacks[K]
      >();
    }
    (this.listeners[event] as Set<EventCallbacks[K]>).add(callback);
  }

  public removeListener<K extends AnamEvent>(
    event: K,
    callback: EventCallbacks[K],
  ): void {
    if (!this.listeners[event]) return;
    (this.listeners[event] as Set<EventCallbacks[K]>).delete(callback);
  }

  public emit<K extends AnamEvent>(
    event: K,
    ...args: EventCallbacks[K] extends (...args: infer P) => any ? P : never
  ): void {
    if (!this.listeners[event]) return;
    (this.listeners[event] as Set<EventCallbacks[K]>).forEach((callback) => {
      (callback as (...args: any[]) => void)(...args);
    });
  }
}
