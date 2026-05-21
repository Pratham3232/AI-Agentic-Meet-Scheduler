import { NextResponse } from 'next/server';

export const maxDuration = 10;

/**
 * POST /api/realtime/session
 * Mints an ephemeral client secret for the browser to connect directly to
 * the OpenAI Realtime API via WebRTC. Configures transcription, VAD, and voice.
 */
export async function POST() {
  const t0 = Date.now();
  try {
    const tFetch = Date.now();
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: 'gpt-realtime-mini',
          audio: {
            input: {
              transcription: { model: 'whisper-1', language: 'en' },
              turn_detection: {
                type: 'server_vad',
                silence_duration_ms: 800,
                threshold: 0.6,
                prefix_padding_ms: 200,
              },
            },
            output: {
              voice: 'coral',
            },
          },
        },
      }),
    });

    const data = await response.json();
    console.log(`[PERF][realtime/session] OpenAI client_secrets fetch: ${Date.now() - tFetch}ms`);

    if (!response.ok) {
      console.error('[realtime/session] OpenAI error:', JSON.stringify(data));
      return NextResponse.json({ error: data?.error?.message || 'Failed to create realtime session' }, { status: 502 });
    }

    console.log(`[PERF][realtime/session] total: ${Date.now() - t0}ms`);
    return NextResponse.json({
      token: data.value,
      expires_at: data.expires_at,
      sessionId: data.session?.id,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[realtime/session] error:', msg);
    console.log(`[PERF][realtime/session] total (error): ${Date.now() - t0}ms`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
