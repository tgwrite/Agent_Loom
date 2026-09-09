import type { RuntimeRef } from './actor/index.ts';
import type { AgentEffect } from './context/index.ts';
import type { EventEnvelope } from './event/index.ts';
import type { JsonValue } from './json.ts';

export interface RuntimeTool {
  id: string;
  description: string;
  input_schema: JsonValue;
  execute(input: JsonValue): Promise<JsonValue>;
}

// Provisional Host contract. Verify this surface against actual Plugins in Phase 0.
export interface RuntimeAdapter {
  readonly runtime: RuntimeRef;
  exec(command: string, args: readonly string[]): Promise<{
    exit_code: number;
    stdout: string;
    stderr: string;
  }>;
  registerTool(tool: RuntimeTool): void;
  registerCommand(id: string, handler: (args: string) => Promise<void>): void;
  isolatedCompletion(request: {
    system_prompt: string;
    prompt: string;
    tools: readonly [];
  }): Promise<string>;
  subscribe(observer: (event: EventEnvelope) => Promise<void>): () => void;
  applyEffect(effect: AgentEffect): Promise<void>;
}
