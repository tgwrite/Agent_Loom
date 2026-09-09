import { create_telemetry_extension } from '@spences10/pi-telemetry';
import { join } from 'node:path';

// A documented native factory override. No persisted global preference is changed.
export default async function telemetry(pi) {
  const root = process.env.LOOM_TEST_TASK_ROOT;
  if (!root) throw new Error('Test Task root required');
  await create_telemetry_extension({ enabled: true, cwd: root,
    db_path: join(root, 'metrics', 'telemetry.db') })(pi);
  if (process.env.LOOM_TEST_OBSERVER_FAULT === '1') {
    pi.on('tool_execution_end', () => { throw new Error('Injected observer failure'); });
  }
}
