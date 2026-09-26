import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './VoiceButton.css';

// Speech-to-text with the phone's own recogniser (Web Speech API): free, needs HTTPS.
// Chrome/Android and Safari/iOS support it; elsewhere the button simply doesn't show.

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const Speech = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

const LANG_KEY = 'family.voiceLang';
const LANGS = [
  { code: 'pt-PT', label: 'PT' },
  { code: 'en-GB', label: 'EN' },
];

function readLang(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGS.some((l) => l.code === saved)) return saved;
  } catch {
    /* private mode */
  }
  return 'pt-PT';
}

interface Props {
  onText: (text: string) => void; // live transcript while speaking
  onDone: (text: string) => void; // final transcript
  onError?: (message: string) => void;
}

export function VoiceButton({ onText, onDone, onError }: Props) {
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState(readLang);
  const rec = useRef<Recognition | null>(null);
  const text = useRef('');

  useEffect(() => () => rec.current?.stop(), []);
  if (!Speech || !window.isSecureContext) return null;

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Speech!();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    text.current = '';
    r.onresult = (e) => {
      text.current = Array.from(e.results).map((res) => res[0]?.transcript ?? '').join(' ').trim();
      onText(text.current);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') onError?.('Allow the microphone for this site to talk to it.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.("Didn't catch that. Try again.");
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (text.current) onDone(text.current);
    };
    rec.current = r;
    setListening(true);
    r.start();
  }

  function switchLang() {
    const next = LANGS[(LANGS.findIndex((l) => l.code === lang) + 1) % LANGS.length]!.code;
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* private mode */
    }
  }

  return (
    <span className="voice">
      <button type="button" className="lang" onClick={switchLang} aria-label={`Speech language: ${lang}. Tap to change.`} disabled={listening}>
        {LANGS.find((l) => l.code === lang)!.label}
      </button>
      <button type="button" className={`mic ${listening ? 'listening' : ''}`} onClick={toggle} aria-label={listening ? 'Stop listening' : 'Speak'} aria-pressed={listening}>
        <Icon name="mic" size={18} />
      </button>
    </span>
  );
}
