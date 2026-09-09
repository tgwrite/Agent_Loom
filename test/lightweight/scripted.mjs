import { randomUUID } from 'node:crypto';

// Only model decisions are scripted. Pi's agent loop, extension hooks, tools,
// filesystem, HTTP conversion, export and telemetry all execute normally.
export async function installScriptedDecisions(session, profile, url, exportFault = false) {
  const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai');
  let step = 0;
  session.agent.streamFunction = model => {
    const stream = createAssistantMessageEventStream();
    let call;
    if (profile === 'fetch' && step === 0) {
      call = { name: 'http_fetch', arguments: { url, strip: 'html2md', max_bytes: 1000000, max_lines: 20000 } };
    } else if (profile === 'report') {
      if (step === 0) call = { name: 'read', arguments: { path: 'source.md' } };
      if (step === 1) call = { name: 'scaffold_artifact', arguments: { type: 'markdown', title: `Loom smoke ${randomUUID()}` } };
      if (step === 2) {
        const scaffold = session.messages.findLast(m => m.role === 'toolResult' && m.toolName === 'scaffold_artifact');
        call = { name: 'write', arguments: { path: scaffold.details.entry,
          content: '# Transport verification report\n\nThe verified source snapshot was read in this independent session.\n\nThis deterministic report tests native export and delivery; it does not summarize or verify website claims.\n' } };
      }
      if (step === 3) {
        const scaffold = session.messages.findLast(m => m.role === 'toolResult' && m.toolName === 'scaffold_artifact');
        call = { name: 'export_artifact', arguments: { id: exportFault ? `missing-${randomUUID()}` : scaffold.details.id } };
      }
    }
    step++;
    const content = call ? [{ type: 'toolCall', id: randomUUID(), ...call }] : [{ type: 'text', text: 'Scripted native-tool sequence complete.' }];
    const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: call ? 'toolUse' : 'stop', timestamp: Date.now() };
    stream.push({ type: 'done', reason: message.stopReason, message });
    stream.end(message);
    return stream;
  };
}
