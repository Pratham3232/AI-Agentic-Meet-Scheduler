/**
 * Serializes OpenAI Realtime `response.create` so only one response is active at a time,
 * and batches parallel function_call outputs into a single continuation.
 * Completion responses (post-SSE) use a separate lane that bypasses continuationSentForTurn.
 */

export type DcSendFn = (payload: string) => void;

export class RealtimeResponseGate {
  private activeResponseId: string | null = null;
  private inflightCallIds = new Set<string>();
  private pendingCreate = false;
  private continuationSentForTurn = false;
  private completionPending = false;
  private completionInstructions: string | null = null;
  private sendFn: DcSendFn | null = null;

  setSendFn(fn: DcSendFn | null): void {
    this.sendFn = fn;
  }

  reset(): void {
    this.activeResponseId = null;
    this.inflightCallIds.clear();
    this.pendingCreate = false;
    this.continuationSentForTurn = false;
    this.completionPending = false;
    this.completionInstructions = null;
  }

  onResponseCreated(responseId: string): void {
    this.activeResponseId = responseId;
    this.continuationSentForTurn = false;
  }

  onResponseEnded(): void {
    this.activeResponseId = null;
    this.continuationSentForTurn = false;
    this.flushCompletion();
    this.flushPending();
  }

  /** Call when the model finishes emitting a function call (before async tool runs). */
  registerFunctionCall(callId: string): void {
    this.inflightCallIds.add(callId);
  }

  /** Post tool output to the conversation; defer response.create until safe. */
  submitToolResult(callId: string, output: unknown): void {
    this.inflightCallIds.delete(callId);
    const send = this.sendFn;
    if (!send) return;

    send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(output),
        },
      })
    );

    this.pendingCreate = true;
    this.flushPending();
  }

  /** User-initiated turn (e.g. slot pick) — queue create when idle. */
  requestResponse(): void {
    this.pendingCreate = true;
    this.flushPending();
  }

  /**
   * After [BOOKING_COMPLETE] / [CANCEL_COMPLETE]: speak success without competing
   * with tool continuationSentForTurn.
   */
  requestCompletionResponse(instructions?: string): void {
    this.completionPending = true;
    this.completionInstructions = instructions ?? null;
    this.flushCompletion();
  }

  private flushCompletion(): void {
    if (!this.completionPending) return;
    if (this.inflightCallIds.size > 0) return;
    if (this.activeResponseId !== null) return;

    const send = this.sendFn;
    if (!send) return;

    const payload: Record<string, unknown> = { type: 'response.create' };
    if (this.completionInstructions) {
      payload.response = { instructions: this.completionInstructions };
    }
    send(JSON.stringify(payload));
    this.completionPending = false;
    this.completionInstructions = null;
    this.continuationSentForTurn = true;
  }

  private flushPending(): void {
    if (!this.pendingCreate || this.continuationSentForTurn) return;
    if (this.inflightCallIds.size > 0) return;
    if (this.activeResponseId !== null) return;

    const send = this.sendFn;
    if (!send) return;

    send(JSON.stringify({ type: 'response.create' }));
    this.pendingCreate = false;
    this.continuationSentForTurn = true;
  }
}
