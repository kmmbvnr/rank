export interface VoiceDictationOptions {
    onStart?: () => void;
    onResult?: (transcript: string, isFinal: boolean) => void;
    onEnd?: () => void;
    onError?: (error: unknown) => void;
    silenceTimeoutMs?: number;
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
    private finished = false;
    private options: VoiceDictationOptions;
    private silenceTimeoutMs: number;

    constructor(options: VoiceDictationOptions) {
        this.options = options;
        this.silenceTimeoutMs = options.silenceTimeoutMs ?? 2500;
    }

    start(): boolean {
        if (!SpeechRecognitionAPI) return false;
        if (this.running) return true;

        try {
            const recognition = new SpeechRecognitionAPI();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;
            if (typeof navigator !== 'undefined' && navigator.language) {
                recognition.lang = navigator.language;
            }

            this.recognition = recognition;
            this.running = true;
            this.finished = false;

            recognition.onstart = () => {
                this.options.onStart?.();
                this.resetSilenceTimer();
            };

            recognition.onspeechstart = () => {
                this.resetSilenceTimer();
            };

            recognition.onresult = (event: any) => {
                this.resetSilenceTimer();
                const parts: string[] = [];
                let hasFinal = false;

                for (let i = 0; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result && result[0]) {
                        const text = String(result[0].transcript || '').trim();
                        if (text) parts.push(text);
                        if (result.isFinal) hasFinal = true;
                    }
                }

                const fullTranscript = parts.join(' ');
                this.options.onResult?.(fullTranscript, hasFinal);
            };

            recognition.onerror = (error: any) => {
                this.options.onError?.(error);
                this.finish();
            };

            recognition.onend = () => {
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
        if (this.finished) return;
        this.finished = true;
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
