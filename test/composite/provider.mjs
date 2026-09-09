import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Local deterministic model endpoint. The native reviewer still runs real Pi
// processes, reads the projected log through Pi's tool and writes its own files.
export async function provider(fault = false) {
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      requests.push(body);
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(body.model, 'retro-fixture');
      if (fault) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Injected review provider failure', type: 'invalid_request_error' } })); return; }
      const prompt = body.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string'
        ? m.content : m.content.map(part => part.text ?? '').join('\n')).join('\n');
      const path = prompt.match(/Analyze this session JSONL file: ([^\n]+)/)?.[1];
      const read = body.messages.some(m => m.role === 'tool');
      const call = path && !read ? { index: 0, id: 'call_review_read', type: 'function',
        function: { name: 'read', arguments: JSON.stringify({ path: path.trim() }) } } : undefined;
      const content = path ? '# Session Review\n\n## Summary\nRETRO_PRIVATE_CANARY: Native session log read successfully. Deterministic transport review; no quality claim.\n'
        : '# Agent Improvement Report\n\n## Executive summary\nRETRO_PRIVATE_CANARY: Keep explicit input validation. Deterministic synthesis; no quality claim.\n';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = (delta, finish_reason) => 'data: ' + JSON.stringify({ id: 'local-review', object: 'chat.completion.chunk',
        created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
      res.write(frame(call ? { role: 'assistant', tool_calls: [call] } : { role: 'assistant', content }, null));
      res.write(frame({}, call ? 'tool_calls' : 'stop'));
      res.end('data: [DONE]\n\n');
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise((done, fail) => { server.on('error', fail); server.listen(0, 'localhost', done); });
  const baseUrl = new URL('http://localhost/v1');
  baseUrl.port = String(server.address().port);
  return { requests, baseUrl: baseUrl.href, async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
