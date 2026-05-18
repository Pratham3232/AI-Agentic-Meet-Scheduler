'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import ChatWindow from '@/components/ChatWindow';
import VoiceButton, { VoiceState } from '@/components/VoiceButton';

type Message = { role: string; content: string };

// ── VAD parameters ────────────────────────────────────────────────────────────
const VAD = {
  SILENCE_THRESHOLD: 0.013,
  SILENCE_DURATION:  1500,
  MIN_SPEECH_MS:     500,
  SAMPLE_INTERVAL:   80,
  MAX_RECORDING_MS:  60000,
  HIGH_PASS_HZ:      80,
};

function getSupportedMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

export default function Home() {
  const [messages, setMessages]     = useState<Message[]>([
    { role: 'assistant', content: "Hi! I'm your scheduling assistant. I can help you find and book meeting times. What would you like to schedule?" },
  ]);
  const [input, setInput]           = useState('');
  const [isLoading, setIsLoading]   = useState(false);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const recorderRef      = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);
  const audioRef         = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef       = useRef<string | null>(null);
  const vadTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const maxTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef         = useRef<AbortController | null>(null);

  // ── Stop TTS playback ─────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    setIsSpeaking(false);
  }, []);

  // ── TTS playback — fire-and-forget alongside text ──────────────────────────
  // Text is already shown. This fetches audio in background and plays when ready.
  const playTTS = useCallback(async (voiceScript: string) => {
    stopSpeaking();

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: voiceScript }),
        signal: abort.signal,
      });

      if (!res.ok) return;
      if (abort.signal.aborted) return;

      const blob = await res.blob();
      if (abort.signal.aborted) return;

      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onplay  = () => setIsSpeaking(true);
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      await audio.play();
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.warn('[TTS] error:', err);
      setIsSpeaking(false);
    }
  }, [stopSpeaking]);

  // ── Send text to chat API ─────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    stopSpeaking();
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsLoading(true);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res  = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, timezone }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const reply: string       = data.message;
      const voiceScript: string = data.voiceScript ?? reply;

      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

      // Show text immediately — no waiting for TTS
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);

      // Fire TTS in parallel — voice arrives 1-2s after text (OpenAI generation time)
      playTTS(voiceScript);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, sessionId, stopSpeaking, playTTS]);

  // ── Clean up recording resources ──────────────────────────────────────────
  const cleanupRecording = useCallback(() => {
    if (vadTimerRef.current)  { clearInterval(vadTimerRef.current);  vadTimerRef.current  = null; }
    if (maxTimerRef.current)  { clearTimeout(maxTimerRef.current);   maxTimerRef.current  = null; }
    if (audioCtxRef.current)  { audioCtxRef.current.close();         audioCtxRef.current  = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setAudioLevel(0);
  }, []);

  // ── Stop recording → Whisper → auto-send ─────────────────────────────────
  const stopAndTranscribe = useCallback(async (mimeType: string) => {
    cleanupRecording();
    setVoiceState('transcribing');
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    try {
      if (blob.size < 1000) {
        setVoiceError('No audio detected. Try speaking closer to the mic.');
        setVoiceState('idle');
        return;
      }

      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      const form = new FormData();
      form.append('audio', blob, `recording.${ext}`);

      const res  = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const transcript = (data.text as string).trim();
      setVoiceState('idle');

      if (!transcript) { setVoiceError('Could not understand audio. Please try again.'); return; }
      setVoiceError(null);
      await sendMessage(transcript);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Transcription failed');
      setVoiceState('idle');
    }
  }, [cleanupRecording, sendMessage]);

  // ── Voice button click handler ────────────────────────────────────────────
  const handleVoiceClick = useCallback(async () => {
    setVoiceError(null);

    if (isSpeaking) { stopSpeaking(); return; }
    if (voiceState === 'recording') { recorderRef.current?.stop(); return; }
    if (voiceState !== 'idle') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current   = [];

      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop          = () => stopAndTranscribe(recorder.mimeType || mimeType || 'audio/webm');
      recorder.start(250);
      setVoiceState('recording');

      // ── VAD setup ──────────────────────────────────────────────────────────
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source   = audioCtx.createMediaStreamSource(stream);
      const hpFilter = audioCtx.createBiquadFilter();
      hpFilter.type  = 'highpass';
      hpFilter.frequency.value = VAD.HIGH_PASS_HZ;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;

      source.connect(hpFilter);
      hpFilter.connect(analyser);

      const buf         = new Float32Array(analyser.frequencyBinCount);
      let speechStart:  number | null = null;
      let silenceStart: number | null = null;

      vadTimerRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);

        setAudioLevel(Math.min(rms / VAD.SILENCE_THRESHOLD, 1));

        const now = Date.now();
        if (rms > VAD.SILENCE_THRESHOLD) {
          if (!speechStart) speechStart = now;
          silenceStart = null;
        } else {
          if (speechStart && !silenceStart) silenceStart = now;
          if (
            speechStart &&
            now - speechStart  >= VAD.MIN_SPEECH_MS &&
            silenceStart &&
            now - silenceStart >= VAD.SILENCE_DURATION
          ) {
            clearInterval(vadTimerRef.current!);
            vadTimerRef.current = null;
            recorderRef.current?.stop();
          }
        }
      }, VAD.SAMPLE_INTERVAL);

      maxTimerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      }, VAD.MAX_RECORDING_MS);

    } catch (err) {
      cleanupRecording();
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setVoiceError('Microphone access denied. Allow mic access in browser settings.');
      } else {
        setVoiceError('Could not start recording. Check your microphone.');
      }
    }
  }, [voiceState, isSpeaking, stopSpeaking, stopAndTranscribe, cleanupRecording]);

  const handleSend    = useCallback(() => sendMessage(input), [input, sendMessage]);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  useEffect(() => () => { stopSpeaking(); cleanupRecording(); }, [stopSpeaking, cleanupRecording]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveVoiceState: VoiceState = isSpeaking ? 'speaking' : voiceState;

  return (
    <div className="container">
      <div className="chat-window">
        <div className="chat-header">
          Smart Scheduler AI
          {isSpeaking && <span className="speaking-indicator" title="Speaking…"> 🔊</span>}
        </div>

        <ChatWindow messages={messages} isLoading={isLoading} />

        {voiceError && <div className="voice-error">{voiceError}</div>}

        {voiceState === 'recording' && (
          <div className="audio-level-bar-wrap">
            <div
              className="audio-level-bar"
              style={{ width: `${Math.round(audioLevel * 100)}%` }}
            />
            <span className="audio-level-hint">
              Listening… I'll send automatically when you stop speaking
            </span>
          </div>
        )}

        <div className="chat-input-container">
          <input
            type="text"
            className="chat-input"
            placeholder={
              voiceState === 'recording'    ? 'Listening — stop speaking to auto-send…' :
              voiceState === 'transcribing' ? 'Transcribing…' :
              isSpeaking                    ? 'Speaking — click to stop' :
              'Type or use the mic…'
            }
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || voiceState !== 'idle'}
          />
          <button
            className="send-button"
            onClick={handleSend}
            disabled={isLoading || !input.trim() || voiceState !== 'idle'}
          >
            ➤
          </button>
          <VoiceButton state={effectiveVoiceState} onClick={handleVoiceClick} />
        </div>
      </div>
    </div>
  );
}
