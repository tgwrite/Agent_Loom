import { application as forward } from './application.mjs';
export const nativeHost = './host.mjs';
export const application = structuredClone(forward);
application.id = 'web-review-reversed';
for (const profile of application.profiles) profile.aspects.reverse();
