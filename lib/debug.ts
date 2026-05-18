export type DebugEntry =
  | { type: 'slot_extraction'; message: string; changes: string[]; state: Record<string, any> }
  | { type: 'stale_search'; reason: string }
  | { type: 'llm_call'; model: string; messageCount: number; toolsEnabled: boolean }
  | { type: 'llm_response'; hasToolCalls: boolean; toolNames?: string[]; textPreview?: string }
  | { type: 'tool_call'; tool: string; args: Record<string, any> }
  | { type: 'tool_result'; tool: string; summary: string }
  | { type: 'calendar_query'; startTime: string; endTime: string; duration: number; timezone: string }
  | { type: 'freebusy_result'; busyCount: number; freeCount: number; strategy: string }
  | { type: 'conflict_resolution'; step: number; strategy: string; slotsFound: number }
  | { type: 'final_response'; textLength: number };

export class DebugLogger {
  entries: DebugEntry[] = [];

  log(entry: DebugEntry) {
    this.entries.push(entry);
    const prefix = `[SCHEDULER:${entry.type}]`;

    switch (entry.type) {
      case 'slot_extraction':
        console.log(`${prefix} msg="${entry.message.slice(0, 60)}" changes=[${entry.changes.join(', ')}]`);
        break;
      case 'stale_search':
        console.log(`${prefix} ${entry.reason}`);
        break;
      case 'llm_call':
        console.log(`${prefix} model=${entry.model} msgs=${entry.messageCount} tools=${entry.toolsEnabled}`);
        break;
      case 'llm_response':
        console.log(
          `${prefix} toolCalls=${entry.hasToolCalls} tools=[${entry.toolNames?.join(',') ?? ''}] text="${entry.textPreview?.slice(0, 80) ?? ''}"`
        );
        break;
      case 'tool_call':
        console.log(`${prefix} tool=${entry.tool} args=${JSON.stringify(entry.args)}`);
        break;
      case 'tool_result':
        console.log(`${prefix} tool=${entry.tool} ${entry.summary}`);
        break;
      case 'calendar_query':
        console.log(`${prefix} ${entry.startTime} → ${entry.endTime} (${entry.duration}min) tz=${entry.timezone}`);
        break;
      case 'freebusy_result':
        console.log(`${prefix} busy=${entry.busyCount} free=${entry.freeCount} strategy=${entry.strategy}`);
        break;
      case 'conflict_resolution':
        console.log(`${prefix} step=${entry.step} strategy=${entry.strategy} slots=${entry.slotsFound}`);
        break;
      case 'final_response':
        console.log(`${prefix} len=${entry.textLength}`);
        break;
    }
  }

  summary() {
    return this.entries;
  }
}
