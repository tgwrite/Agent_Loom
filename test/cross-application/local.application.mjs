import { application as reference } from '../reuse/application.mjs';
export const nativeHost = './host.mjs';
export const application = {
  id: 'local-json', version: '0.1.0', runtime: { id: 'pi', version: '0.85.1' },
  plugins: [
    { id: 'local-transform', role: 'domain', native: { runtime: 'pi', binding_key: 'local-json' }, capabilities: [],
      produces: [{ type: 'local.result', version: '1' }] },
    ...structuredClone(reference.plugins.filter(p => p.role === 'aspect')),
  ],
  profiles: [{ id: 'transform', primary: 'local-transform', aspects: ['run-metrics', 'conversation-review', 'session-audit'],
    workspace: 'local', requirements: [] }],
};
