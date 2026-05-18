import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: 'No form data provided' }, { status: 400 });
    }
    const audio = formData.get('audio') as File | null;

    if (!audio) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Whisper accepts webm (Chrome), ogg (Firefox), mp4 (Safari) — pass through directly
    const file = await toFile(audio, `recording.${getExtension(audio.type)}`, {
      type: audio.type,
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'en',
    });

    return NextResponse.json({ text: transcription.text });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[transcribe] error:', msg);
    return NextResponse.json({ error: 'Transcription failed', detail: msg }, { status: 500 });
  }
}

function getExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg'))  return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'mp4';
  if (mimeType.includes('wav'))  return 'wav';
  return 'webm'; // safe default
}
