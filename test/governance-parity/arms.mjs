// Transport only: no validation, provenance repair, or governance implementation.
import { LocalTaskStore, prepareSession, executeSession, inspectTask } from '../../packages/container-core/src/index.ts';
import { createPiApplicationHost } from '../../packages/runtime-pi/src/index.ts';
import { ControlStore } from './control/store.mjs';
import { prepare, execute } from './control/runtime.mjs';
export const arms = {
  loom: { create: (root, task) => LocalTaskStore.create(root, task), open: root => LocalTaskStore.open(root),
    prepare: prepareSession, run: (store, plan, options) => executeSession(store, plan, createPiApplicationHost({ store, ...options }), { id: 'local-operator' }), inspect: inspectTask },
  control: { create: (root, task) => ControlStore.create(root, task), open: root => ControlStore.open(root),
    prepare, run: execute, inspect: store => store.inspect() },
};
