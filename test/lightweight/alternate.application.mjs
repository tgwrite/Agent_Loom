import { application as base, nativeHost } from './application.mjs';
export { nativeHost };
export const application = structuredClone(base);
application.id = 'web-brief';
application.profiles[0].id = 'capture';
application.profiles[0].workspace = 'input';
application.profiles[1].id = 'publish';
application.profiles[1].workspace = 'output';
