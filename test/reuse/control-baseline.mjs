import { registerHooks } from 'node:module';

// Bind the added native adapter without editing the previous control's governance.
// The resolver override is confined to that module's setup import.
const control = new URL('../composite/control.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL === control && specifier === './setup.mjs'
    ? new URL('./setup.mjs', import.meta.url).href : specifier, context);
} });
await import(control);
