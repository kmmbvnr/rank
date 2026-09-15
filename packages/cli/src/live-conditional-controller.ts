import { parse } from '@arrrank/interpreter';
import { isIfStatement } from '@arrrank/language';
import type { LiveSubmitResult } from './live-function-controller.js';
import { LivePreviewRunner } from './live-preview.js';
import type { Notebook } from './notebook.js';
import type { OutputLine } from './repl-session.js';
import type { ReplSession } from './repl-types.js';

interface LiveConditional {
    source: string;
    readonly outputs: Map<number, OutputLine[]>;
    readonly prefixes: Map<number, string>;
    readonly cellIndex: number;
    readonly existing: boolean;
    readonly originalSource?: string;
}

/** Owns isolated per-line previews for one top-level conditional edit. */
export class LiveConditionalController {
    private live?: LiveConditional;
    private readonly preview: LivePreviewRunner;

    constructor(
        private readonly notebook: Notebook,
        private readonly session: ReplSession,
        private readonly columns: () => number,
        private readonly setSuggestion: (text: string) => void,
        private readonly render: () => void,
        readonly enabled: boolean,
    ) {
        this.preview = new LivePreviewRunner(source => this.session.preview(source, this.columns()));
    }

    get outputs(): ReadonlyMap<number, OutputLine[]> | undefined { return this.live?.outputs; }
    get editing(): boolean { return this.live !== undefined; }
    get status(): string | undefined {
        if (!this.live) return undefined;
        const source = this.notebook.current.source;
        const end = source.indexOf('\n', this.notebook.cursor);
        const line = source.slice(source.lastIndexOf('\n', this.notebook.cursor - 1) + 1,
            end < 0 ? source.length : end).trim();
        const action = !line ? 'Enter keep blank line'
            : /^(?:else|elif)\b/.test(line) ? 'Enter enter branch'
            : line === 'end' ? 'Enter apply end' : 'Enter evaluate line';
        return `Live if · ${action} · selected branch only`;
    }

    clear(): void { this.live = undefined; }

    async begin(source: string): Promise<boolean> {
        if (!this.enabled || this.live || source.includes('\n') || !/^\s*if\s+\S/.test(source)) return false;
        const existing = !this.notebook.atPrompt;
        this.live = {
            source: `${source.trim()}\n  `,
            outputs: new Map(), prefixes: new Map(), cellIndex: this.notebook.active, existing,
            originalSource: existing ? source : undefined,
        };
        this.notebook.replace(this.live.source);
        await this.update(false, 1);
        if (this.live.outputs.get(1)?.some(output => output.error)) this.placeCursorAtLineEnd(0);
        this.updateSuggestion();
        this.render();
        return true;
    }

    cancel(): void {
        const live = this.live;
        if (!live) return;
        if (live.existing && live.originalSource !== undefined) {
            this.notebook.replace(live.originalSource);
            this.notebook.cursor = Math.min(this.notebook.cursor, live.originalSource.length);
        }
        this.live = undefined;
        this.notebook.toPrompt();
        if (!live.existing) this.notebook.replace('');
        this.setSuggestion('');
    }

    async rerun(): Promise<boolean> {
        if (!this.live && !this.beginExisting()) return false;
        const live = this.live!;
        live.source = this.notebook.current.source;
        const line = selectedLine(live.source, this.notebook.cursor);
        await this.update(true, line - 1);
        this.placeCursorAtLineEnd(line - 1);
        this.render();
        return true;
    }

    async forcePreview(): Promise<boolean> {
        if (!this.live) return false;
        this.notebook.formatCurrentLine(line => this.session.format(line));
        const source = this.notebook.current.source;
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        if (!/\n[\t ]*$/.test(source)) this.notebook.preparePrompt(line => this.session.format(line));
        await this.update(true, currentLine + 1);
        this.placeCursorAfterLine(currentLine);
        this.render();
        return true;
    }

    async submit(): Promise<LiveSubmitResult> {
        const live = this.live;
        if (!live) return 'absent';
        this.notebook.formatCurrentLine(line => this.session.format(line));
        const source = this.notebook.current.source;
        const lines = source.split('\n');
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        if (currentLine < lines.length - 1) {
            await this.update(false, currentLine + 1);
            this.placeCursorAfterLine(currentLine);
            this.render();
            return 'handled';
        }
        if (!lines[currentLine].trim()) {
            this.notebook.newline();
            this.updateSuggestion();
            this.render();
            return 'handled';
        }
        const draft = this.notebook.preparePrompt(line => this.session.format(line));
        if (draft !== undefined) {
            this.live = undefined;
            this.setSuggestion('');
            if (live.existing) {
                this.notebook.replayFrom = live.cellIndex;
                this.notebook.toPrompt();
                return 'replay';
            }
            return 'complete';
        }
        await this.update(false, currentLine + 1);
        this.placeCursorAfterLine(currentLine);
        this.render();
        return 'handled';
    }

    private beginExisting(): boolean {
        if (!this.enabled || this.notebook.atPrompt) return false;
        const source = this.notebook.current.source;
        try {
            const statements = parse(source).statements;
            if (statements.length !== 1 || !isIfStatement(statements[0])) return false;
        } catch { return false; }
        this.live = {
            source, outputs: new Map(), prefixes: new Map(), cellIndex: this.notebook.active,
            existing: true, originalSource: source,
        };
        this.updateSuggestion();
        return true;
    }

    private async update(reset = false, throughLine?: number): Promise<void> {
        if (!this.live) return;
        await this.preview.updateConditional(this.live, this.notebook.current.source, reset, throughLine);
        this.updateSuggestion();
    }

    private updateSuggestion(): void {
        if (this.live) this.setSuggestion('');
    }

    private placeCursorAfterLine(line: number): void {
        const lines = this.notebook.current.source.split('\n');
        const start = lines.slice(0, line).reduce((offset, item) => offset + item.length + 1, 0);
        const failed = this.live?.outputs.get(line + 1)?.some(output => output.error) ?? false;
        this.notebook.cursor = failed || line >= lines.length - 1
            ? start + lines[line].length : start + lines[line].length + 1 + lines[line + 1].length;
    }

    private placeCursorAtLineEnd(line: number): void {
        const lines = this.notebook.current.source.split('\n');
        const at = Math.max(0, Math.min(line, lines.length - 1));
        this.notebook.cursor = lines.slice(0, at).reduce((offset, item) => offset + item.length + 1, 0) + lines[at].length;
    }
}

function selectedLine(source: string, cursor: number): number {
    return Math.max(1, Math.min(source.slice(0, cursor).split('\n').length, source.split('\n').length));
}
