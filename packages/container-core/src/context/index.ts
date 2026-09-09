import type { ActorRef } from '../actor/index.ts';
import type { JsonValue } from '../json.ts';

export interface PluginContext {
  plugin_id: string;
  task_id: string;
  session_id: string;
  actor: ActorRef;
  private_state: Map<string, JsonValue>;
}

// Effects require an explicit Runtime call; persistence has no context side effects.
export type AgentEffect =
  | { kind: 'system-policy'; plugin_id: string; text: string }
  | { kind: 'temporary-context'; plugin_id: string; text: string; scope: 'turn' };
