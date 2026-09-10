import { definition, domains } from './domains.mjs';
export const application = definition('catalog');
export const nativeHost = './host.mjs';
export function validateTaskInput(value) { domains.catalog.parse(value); }
