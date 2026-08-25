/// <reference types="vite/client" />

/* eslint-disable no-var */
// Minimal Web Speech API typings (not present in the default DOM lib).
interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionEvent extends Event {
  results: {
    length: number;
    [index: number]: {
      length: number;
      [index: number]: SpeechRecognitionResultItem;
    };
  };
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

declare var SpeechRecognition: { prototype: SpeechRecognition; new (): SpeechRecognition } | undefined;
declare var webkitSpeechRecognition: { prototype: SpeechRecognition; new (): SpeechRecognition } | undefined;
