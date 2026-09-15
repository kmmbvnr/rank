import type { Key } from './key-router.js';
import type { NotebookRepl } from './repl.js';

export interface ModeKeyResult { handled: boolean; exit?: boolean; render?: boolean }

/** Routes keys owned by full-screen modes outside ordinary notebook editing. */
export class TerminalModeRouter {
    private stepping = false;

    constructor(
        private readonly repl: NotebookRepl,
        private readonly rows = () => 24,
    ) {}

    get active(): boolean { return this.repl.running || !!this.repl.savePrompt || !!this.repl.help; }

    allowRender(): boolean {
        if (this.stepping && this.repl.running && !this.repl.session.pauseState) return false;
        this.stepping = false;
        return true;
    }

    async press(text: string, key: Key = {}): Promise<ModeKeyResult> {
        const repl = this.repl;
        if (repl.running) {
            if (key.ctrl && key.name === 'c') { this.stepping = false; repl.interrupt(); }
            else if (key.ctrl && key.name === 'p') { this.stepping = false; repl.togglePause(); }
            else if (repl.session.pauseState) {
                if (key.name === 'return' || key.name === 'enter') repl.session.resume?.();
                else if (!key.meta && key.name === 'g') this.step(() => repl.session.stepToMain?.());
                else if (!key.meta && key.name === 't') this.step(() => repl.session.step?.());
                else if (!key.meta && key.name === 'n') this.step(() => repl.session.step?.(true));
                else if (key.name === 'up') repl.pauseTop--;
                else if (key.name === 'down') repl.pauseTop++;
                else if (key.name === 'pageup') repl.pauseTop -= Math.max(1, this.rows() - 2);
                else if (key.name === 'pagedown') repl.pauseTop += Math.max(1, this.rows() - 2);
                return { handled: true, render: true };
            }
            return { handled: true };
        }

        const prompt = repl.savePrompt;
        if (prompt) {
            if (key.name === 'escape' || key.ctrl && key.name === 'c') repl.savePrompt = undefined;
            else if (prompt.choosing) {
                if (key.name === 'return' || key.name === 'enter' || !key.ctrl && /^[sy]$/i.test(text)) {
                    prompt.choosing = false;
                    if (repl.session.savedFile) return { handled: true, exit: await repl.savePromptFile() };
                } else if (!key.ctrl && /^[dn]$/i.test(text)) {
                    return { handled: true, exit: repl.discardChanges() };
                }
            } else {
                const file = prompt.filename;
                if (key.name === 'return' || key.name === 'enter')
                    return { handled: true, exit: await repl.savePromptFile() };
                if (key.name === 'backspace' || key.name === 'delete') file.erase(key.name === 'backspace');
                else if (key.name === 'left' || key.name === 'right') file.horizontal(key.name === 'left' ? -1 : 1);
                else if (key.name === 'home' || key.ctrl && key.name === 'a') file.lineEdge(false);
                else if (key.name === 'end' || key.ctrl && key.name === 'e') file.lineEdge(true);
                else if (key.ctrl && key.name === 'u') file.replace('');
                else if (!key.ctrl && !key.meta && text && text >= ' ') file.insert(text);
            }
            return { handled: true, render: true };
        }

        if (repl.help) {
            if (key.name === 'escape') repl.help = undefined;
            else if (key.name === 'up') repl.help.top--;
            else if (key.name === 'down') repl.help.top++;
            else if (key.name === 'pageup') repl.help.top -= Math.max(1, this.rows() - 1);
            else if (key.name === 'pagedown') repl.help.top += Math.max(1, this.rows() - 1);
            else if (key.name === 'home') repl.help.top = 0;
            else if (key.name === 'end') repl.help.top = Number.MAX_SAFE_INTEGER;
            return { handled: true, render: true };
        }
        return { handled: false };
    }

    paste(text: string): boolean {
        const repl = this.repl;
        if (repl.running) return true;
        if (repl.savePrompt) {
            if (!repl.savePrompt.choosing) repl.savePrompt.filename.insert(text.replace(/[\r\n]/g, ''));
            return true;
        }
        return !!repl.help;
    }

    private step(action: () => void): void {
        this.stepping = true;
        this.repl.pauseTop = 0;
        action();
    }
}
