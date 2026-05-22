import { NextRequest } from 'next/server';
import { getSession, saveSession } from '@/lib/session/store';
import { getCancelProgress, runCancelJobToCompletion } from '@/lib/agent/cancel-executor';
import { clearSseLock, isStaleSseLock } from '@/lib/agent/job-sse';
import { withCalendarAuth } from '@/lib/calendar/auth';
import { resolveCalendarAuth } from '@/lib/auth/resolve';
import { DebugLogger } from '@/lib/debug';
import type { CancelJob } from '@/types';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { sessionId, batchSize = 5 } = await req.json();
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400 });
  }

  const userAuth = await resolveCalendarAuth();
  const runWithAuth = <T>(fn: () => Promise<T>) =>
    userAuth ? withCalendarAuth(userAuth, fn) : fn();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const debug = new DebugLogger();

      try {
        await runWithAuth(async () => {
          const state = await getSession(sessionId);
          if (!state?.cancelJob) {
            send({ type: 'error', error: 'No active cancel job' });
            controller.close();
            return;
          }

          const progress0 = getCancelProgress(state.cancelJob);
          if (progress0.pending === 0 || state.cancelJob.status === 'completed') {
            send({ type: 'complete', ...progress0, duplicateBlocked: false });
            controller.close();
            return;
          }

          if (isStaleSseLock(state.cancelJob)) {
            state.cancelJob = clearSseLock(state.cancelJob);
            await saveSession(state);
          } else if (state.cancelJob.sseInProgress) {
            send({ type: 'complete', ...progress0, duplicateBlocked: true });
            controller.close();
            return;
          }

          state.cancelJob = {
            ...state.cancelJob,
            sseInProgress: true,
            updatedAt: new Date().toISOString(),
          };
          await saveSession(state);

          const persistProgress = async (job: CancelJob) => {
            state.cancelJob = { ...job, sseInProgress: true };
            await saveSession(state);
          };

          const { job, progress } = await runCancelJobToCompletion(
            state.cancelJob,
            batchSize,
            async p => {
              send({ type: 'progress', ...p });
              await persistProgress({
                ...state.cancelJob!,
                items: p.items,
                status: p.status,
                updatedAt: new Date().toISOString(),
              });
            },
            debug,
            sessionId
          );

          state.cancelJob = { ...job, sseInProgress: false };
          await saveSession(state);
          send({ type: 'complete', ...progress, duplicateBlocked: false });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          const state = await getSession(sessionId);
          if (state?.cancelJob) {
            state.cancelJob = { ...state.cancelJob, sseInProgress: false };
            await saveSession(state);
          }
        } catch {
          /* ignore */
        }
        send({ type: 'error', error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
