import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Streams TTS audio from OpenAI directly to the client.
 * The response is a raw audio/mpeg stream — the browser can start playback
 * as soon as the first chunk arrives (time-to-first-byte ~200ms).
 */
export async function POST(req: NextRequest) {
  try {
    const { text } = (await req.json()) as { text: string };

    if (!text?.trim()) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    // Use mp3 — universally supported, smallest output for short phrases
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      response_format: 'mp3',
      speed: 1.05, // slight speedup for snappier feel
    });

    // Pipe the streaming response body directly to the client
    const audioStream = response.body as ReadableStream<Uint8Array>;

    return new Response(audioStream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[tts] error:', msg);
    return NextResponse.json({ error: 'TTS failed', detail: msg }, { status: 500 });
  }
}
