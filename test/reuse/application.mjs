import { application as prior } from '../composite/application.mjs';
export const nativeHost = './host.mjs';
export const application = structuredClone(prior);
application.id = 'web-review-audit';
application.plugins.push({ id: 'session-audit', role: 'aspect', native: { runtime: 'pi', binding_key: 'audit' },
  capabilities: [], produces: [{ type: 'audit.session-summary', version: '1' }] });
for (const profile of application.profiles) profile.aspects.push('session-audit');
