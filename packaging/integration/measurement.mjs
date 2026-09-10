import { definition, domains } from './domains.mjs';
export const application = definition('measurement');
export const nativeHost = './host.mjs';
export function validateTaskInput(value) { domains.measurement.parse(value); }
