import native from './node_modules/@artale/pi-json/extensions/pi-json.ts';

// Compatibility for the published legacy execute(params) signature only.
// JSON parsing/query semantics remain in the unmodified market package.
export default function jsonNative(pi: any) {
  native(new Proxy(pi, { get(target, key) {
    if (key !== 'registerTool') return Reflect.get(target, key);
    return (tool: any) => target.registerTool({ ...tool, label: tool.name,
      async execute(_id: string, params: unknown) {
        const value = await tool.execute(params);
        return { content: [{ type: 'text', text: JSON.stringify(value) }], details: { value } };
      },
    });
  } }));
}
