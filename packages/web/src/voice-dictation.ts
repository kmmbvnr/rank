import { mergeTranscripts } from '@arrrank/common/comment-wrap';

export interface VoiceDictationOptions {
    onStart?: () => void;
    onResult?: (transcript: string, isFinal: boolean) => void;
    onEnd?: () => void;
    onError?: (error: unknown) => void;
    silenceTimeoutMs?: number;
    lang?: string;
}

const SpeechRecognitionAPI: any =
    typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : undefined;

export function isVoiceSupported(): boolean {
    return Boolean(SpeechRecognitionAPI);
}

export class VoiceDictation {
    private recognition: any = null;
    private silenceTimer: ReturnType<typeof setTimeout> | undefined;
    private running = false;
    private committedTranscript = '';
    private currentTranscript = '';
    private options: VoiceDictationOptions;
    private silenceTimeoutMs: number;
    private lang: string;

    constructor(options: VoiceDictationOptions) {
        this.options = options;
        this.silenceTimeoutMs = options.silenceTimeoutMs ?? 2500;
        this.lang = options.lang ?? 'en-US';
    }

    start(): boolean {
        if (!SpeechRecognitionAPI) return false;
        if (this.running) return true;

        this.running = true;
        this.committedTranscript = '';
        this.currentTranscript = '';

        return this.startSession();
    }

    private startSession(): boolean {
        if (!SpeechRecognitionAPI || !this.running) return false;

        try {
            const recognition = new SpeechRecognitionAPI();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;
            recognition.lang = this.lang;

            this.recognition = recognition;

            recognition.onstart = () => {
                this.options.onStart?.();
                this.resetSilenceTimer();
            };

            recognition.onspeechstart = () => {
                this.resetSilenceTimer();
            };

            recognition.onresult = (event: any) => {
                this.resetSilenceTimer();

                let sessionTranscript = '';
                let hasFinal = false;

                for (let i = 0; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result && result[0]) {
                        const text = String(result[0].transcript || '').trim();
                        if (text) {
                            sessionTranscript = mergeTranscripts(sessionTranscript, text);
                        }
                        if (result.isFinal) hasFinal = true;
                    }
                }

                const fullTranscript = mergeTranscripts(this.committedTranscript, sessionTranscript);

                this.currentTranscript = fullTranscript;
                this.options.onResult?.(fullTranscript, hasFinal);
            };

            recognition.onerror = (event: any) => {
                const error = event?.error;
                if (error === 'no-speech') {
                    // Ignore transient silence from Android speech recognizer;
                    // the silence timer will stop the session if user remains silent.
                    return;
                }
                this.options.onError?.(event);
                this.finish();
            };

            recognition.onend = () => {
                if (this.running) {
                    // Android recognition ended prematurely (e.g. short pause or network reconnect).
                    // Commit current progress and restart; startSession finishes on failure.
                    this.committedTranscript = this.currentTranscript;
                    this.recognition = null;
                    this.startSession();
                    return;
                }
                this.finish();
            };

            recognition.start();
            this.resetSilenceTimer();
            return true;
        } catch (error) {
            this.options.onError?.(error);
            this.finish();
            return false;
        }
    }

    private resetSilenceTimer(): void {
        this.clearSilenceTimer();
        this.silenceTimer = setTimeout(() => {
            this.stop();
        }, this.silenceTimeoutMs);
    }

    private clearSilenceTimer(): void {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = undefined;
        }
    }

    stop(): void {
        this.finish();
    }

    private finish(): void {
        if (!this.running) return;
        this.running = false;
        this.clearSilenceTimer();
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch {
                // Ignore if already stopped
            }
            this.recognition = null;
        }
        this.options.onEnd?.();
    }

    get isRunning(): boolean {
        return this.running;
    }
}

