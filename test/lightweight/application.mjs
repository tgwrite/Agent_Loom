export const nativeHost = './host.mjs';
export const application = {
  id: 'web-report', version: '0.1.0', runtime: { id: 'pi', version: '0.85.1' },
  plugins: [
    { id: 'web-source', role: 'domain', native: { runtime: 'pi', binding_key: 'http-util' },
       produces: [{ type: 'web.source', version: '1' }] },
    { id: 'web-report', role: 'domain', native: { runtime: 'pi', binding_key: 'artifacts' },
       produces: [{ type: 'web.report', version: '1' }] },
    { id: 'run-metrics', role: 'aspect', native: { runtime: 'pi', binding_key: 'telemetry' },
       produces: [] },
  ],
  profiles: [
    { id: 'fetch', primary: 'web-source', aspects: ['run-metrics'], workspace: 'producer', requirements: [] },
    { id: 'report', primary: 'web-report', aspects: ['run-metrics'], workspace: 'consumer',
      requirements: [{ type: 'web.source', version: '1', assertion_status: 'READY' }] },
  ],
};
