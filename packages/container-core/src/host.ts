import type { LocalTaskStore } from './storage/index.ts';
export type { SessionHost, SessionPlan, NativeSessionHandle } from './governance.ts';

/** Trusted Host facts interface. Producer identity must come from trusted bindings.
 * Lifecycle and consumption mutation remain internal to the execution driver. */
export type HostTaskStore = Pick<LocalTaskStore, 'task' | 'taskRoot' | 'getSession' | 'publishArtifact' | 'recordObserverFailure' | 'appendEvent'>;

/** Give trusted integration code only the Host surface, not the concrete storage object. */
export function toHostTaskStore(store: HostTaskStore): HostTaskStore {
  return Object.freeze({ get task() { return store.task; }, get taskRoot() { return store.taskRoot; },
    getSession: store.getSession.bind(store), publishArtifact: store.publishArtifact.bind(store),
    recordObserverFailure: store.recordObserverFailure.bind(store), appendEvent: store.appendEvent.bind(store) });
}
