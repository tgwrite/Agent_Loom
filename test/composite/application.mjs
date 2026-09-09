import { application as web } from '../lightweight/application.mjs';
export const nativeHost = './host.mjs';
export const application = structuredClone(web);
application.id = 'web-review';
application.plugins.push({ id: 'conversation-review', role: 'aspect', native: { runtime: 'pi', binding_key: 'retro' },
  capabilities: [], produces: [{ type: 'retro.session-review', version: '1' }, { type: 'retro.improvement-report', version: '1' }] });
for (const profile of application.profiles) profile.aspects.push('conversation-review');
