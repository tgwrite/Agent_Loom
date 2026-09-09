import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Observes actual provider inputs without replacing the existing domain adapter.
export function instrument(session, context) {
  const requests = [];
  let stream = session.agent.streamFunction;
  Object.defineProperty(session.agent, 'streamFunction', { configurable: true,
    get() { return (model, input, options) => {
      requests.push(JSON.parse(JSON.stringify(input)));
      return stream(model, input, options);
    }; },
    set(value) { stream = value; },
  });
  return { async checkReview(action) {
    const before = JSON.stringify(session.messages);
    const tools = session.extensionRunner.getActiveTools();
    const system = session.systemPrompt;
    let result, error;
    try { result = await action(); } catch (value) { error = value; }
    assert.equal(JSON.stringify(session.messages), before, 'Review changed main history');
    assert.deepEqual(session.extensionRunner.getActiveTools(), tools, 'Review changed main tools');
    assert.equal(session.systemPrompt, system, 'Review changed main system policy');
    await session.prompt('Continue the completed synthetic task with a short status only.');
    assert(requests.length > 0);
    assert(!JSON.stringify(requests).includes('RETRO_PRIVATE_CANARY'));
    assert(!JSON.stringify(requests).includes('strict postmortem reviewer'));
    await writeFile(join(context.workspace, context.session_id, 'isolation.local.json'), JSON.stringify({
      passed: true, actual_load_order: session.extensionRunner.getExtensionPaths(), main_requests: requests,
      tools_unchanged: true, system_unchanged: true, history_unchanged: true,
    }, null, 2));
    if (error) throw error;
    return result;
  } };
}
