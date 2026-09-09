import { application as reference } from '../reuse/application.mjs';
export const nativeHost = './host.mjs';
export const application = {
  id: 'document-pipeline', version: '0.1.0', runtime: { id: 'pi', version: '0.85.1' },
  plugins: [
    ...[['source-capture', 'capture', 'source.snapshot'], ['markdown-normalize', 'normalize', 'normalized.data'],
      ['html-publish', 'publish', 'final.output']].map(([id, binding_key, type]) => ({ id, role: 'domain',
        native: { runtime: 'pi', binding_key }, capabilities: [], produces: [{ type, version: '1' }] })),
    ...structuredClone(reference.plugins.filter(p => p.role === 'aspect')),
  ],
  profiles: [['capture', 'source-capture'], ['normalize', 'markdown-normalize', 'source.snapshot'],
    ['publish', 'html-publish', 'normalized.data']].map(([id, primary, input]) => ({ id, primary, workspace: id,
      aspects: ['run-metrics', 'conversation-review', 'session-audit'], requirements: input
        ? [{ type: input, version: '1', verification_status: 'COMPLETED' }] : [] })),
};
