import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPath, inspectText } from '../../scripts/privacy-rules.mjs';

test('publication rules detect synthetic private paths, credentials and unreviewed URLs', () => {
  const drivePath = ['Q:', 'Users', 'synthetic', 'case'].join(String.fromCharCode(92));
  const privateUrl = ['https:', '', 'internal.example.invalid', 'private-source'].join('/');
  const token = ['ghp', 'x'.repeat(36)].join('_');
  assert.ok(inspectText(drivePath).includes('absolute local path'));
  assert.ok(inspectText(privateUrl).includes('unreviewed external URL'));
  assert.ok(inspectText(token).includes('credential pattern'));
  assert.ok(inspectPath('local/reference-baseline.local.json').length > 0);
  assert.ok(inspectPath('.agent-container/task.json').length > 0);
  assert.ok(inspectPath('.agent-loom/task.json').length > 0);
});

test('public relative references and neutral project email pass', () => {
  assert.deepEqual(inspectText('fixtures/synthetic.json contributors@example.invalid'), []);
  assert.deepEqual(inspectPath('packages/container-core/src/index.ts'), []);
});

test('only the reviewed public repository URLs are exempted from the URL scan', () => {
  const repository = 'https://github.com/tgwrite/Agent_Loom';
  const protocol = ['https:', '', ''].join('/');
  assert.deepEqual(inspectText(repository), []);
  assert.deepEqual(inspectText(repository + '.git'), []);
  for (const value of [repository + '-unreviewed', repository + '/unreviewed', repository + '?value=unreviewed',
    repository.replace('/tgwrite/', '/synthetic-owner/'), repository.replace('https:', 'http:'),
    repository.replace('github.com', 'github.com.invalid'), repository.replace(protocol, protocol + 'synthetic@')]) {
    assert(inspectText(value).includes('unreviewed external URL'));
  }
});
