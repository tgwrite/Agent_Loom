import { application as prior } from './application.mjs';
export const nativeHost = './host.mjs';
export const application = structuredClone(prior);
application.id = 'web-review-audit-reversed';
for (const profile of application.profiles) profile.aspects.reverse();
