// Deliberately synthetic SDK surface: no native plugin, Pi loop or model runs.
import { randomUUID } from 'node:crypto';
export const sdk = {
  SettingsManager: { inMemory: settings => settings },
  SessionManager: { create: () => ({ getSessionId: () => `synthetic-${randomUUID()}` }) },
  DefaultResourceLoader: class {
    constructor(options) { this.options = options; }
    async reload() {}
    getExtensions() { return { errors: [], extensions: this.options.additionalExtensionPaths.map(resolvedPath => ({ resolvedPath })) }; }
  },
  async createAgentSession() { return { session: {
    async prompt() { throw new Error('Synthetic example must not call a model'); },
    async abort() {}, async bindExtensions() {}, extensionRunner: { async emit() {} }, dispose() {},
  } }; },
};
