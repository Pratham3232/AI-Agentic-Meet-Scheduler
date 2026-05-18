// Voice session endpoint — reserved for future OpenAI Realtime API integration.
// Current voice pipeline: browser MediaRecorder → /api/transcribe (Whisper STT)
//   → /api/chat → browser speechSynthesis (TTS).
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok', mode: 'whisper+speechSynthesis' });
}
