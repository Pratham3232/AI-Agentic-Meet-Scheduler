import { NextRequest } from 'next/server';
import { getSession, saveSession } from '@/lib/session/store';
import { getBookingProgress, runBookingJobToCompletion } from '@/lib/agent/booking-executor';
import { clearSseLock, isStaleSseLock } from '@/lib/agent/booking-sse';
import { withCalendarAuth } from '@/lib/calendar/auth';
import { resolveCalendarAuth } from '@/lib/auth/resolve';
import { DebugLogger } from '@/lib/debug';
import type { BookingJob } from '@/types';

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
          if (!state?.bookingJob) {
            send({ type: 'error', error: 'No active booking job' });
            controller.close();
            return;
          }

          const progress0 = getBookingProgress(state.bookingJob);
          if (progress0.pending === 0 || state.bookingJob.status === 'completed') {
            send({ type: 'complete', ...progress0, duplicateBlocked: false });
            controller.close();
            return;
          }

          if (isStaleSseLock(state.bookingJob)) {
            state.bookingJob = clearSseLock(state.bookingJob);
            await saveSession(state);
          } else if (state.bookingJob.sseInProgress) {
            debug.log({
              type: 'booking_sse_end',
              sessionId,
              booked: progress0.booked,
              failed: progress0.failed,
              blocked: true,
            });
            send({ type: 'complete', ...progress0, duplicateBlocked: true });
            controller.close();
            return;
          }

          state.bookingJob = {
            ...state.bookingJob,
            sseInProgress: true,
            updatedAt: new Date().toISOString(),
          };
          await saveSession(state);

          const persistProgress = async (job: BookingJob) => {
            state.bookingJob = {
              ...job,
              sseInProgress: true,
            };
            await saveSession(state);
          };

          const { job, progress, blocked } = await runBookingJobToCompletion(
            state.bookingJob,
            batchSize,
            async p => {
              send({ type: 'progress', ...p });
              await persistProgress({
                ...state.bookingJob!,
                items: p.items,
                status: p.status,
                updatedAt: new Date().toISOString(),
              });
            },
            debug,
            sessionId
          );

          state.bookingJob = { ...job, sseInProgress: false };
          await saveSession(state);

          send({
            type: 'complete',
            ...progress,
            duplicateBlocked: blocked ?? false,
          });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          const state = await getSession(sessionId);
          if (state?.bookingJob) {
            state.bookingJob = { ...state.bookingJob, sseInProgress: false };
            await saveSession(state);
          }
        } catch {
          /* ignore cleanup errors */
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
