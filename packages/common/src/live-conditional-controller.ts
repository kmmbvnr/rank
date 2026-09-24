import { parse } from '@arrrank/interpreter';
import { isForStatement, isIfStatement } from '@arrrank/language';
import type { LiveSubmitResult } from './live-function-controller.js';
import { enclosingIterationLine, LivePreviewRunner } from './live-preview.js';
import type { Notebook } from './notebook.js';
import type { OutputLine } from './repl-session.js';
import type { ReplSession } from './repl-types.js';

interface LiveConditional {
    source: string;
    readonly outputs: Map<number, OutputLine[]>;
    readonly prefixes: Map<number, string>;
    readonly iterations: Map<number, number>;
    readonly slowLines: Set<number>;
    readonly cellId: number;
    readonly existing: boolean;
    readonly originalSource?: string;
}

/** Owns isolated per-line previews for one top-level control-flow edit. */
export class LiveConditionalController {
    private live?: LiveConditional;
    private focusedIteration?: number;
    private focusedThroughLine?: number;
    private readonly preview: LivePreviewRunner;
    private evaluatingStatus?: string;

    constructor(
        private readonly notebook: Notebook,
        private readonly session: ReplSession,
        private readonly columns: () => number,
        private readonly setSuggestion: (text: string) => void,
        private readonly render: () => void,
        readonly enabled: boolean,
    ) {
        this.preview = new LivePreviewRunner(
            source => this.session.preview(source, this.columns()),
            {
                onProgress: status => {
                    this.evaluatingStatus = status;
                    this.render();
                },
                interrupt: () => this.session.interrupt?.(),
            },
        );
    }

    get evaluating(): boolean { return this.evaluatingStatus !== undefined; }

    get outputs(): ReadonlyMap<number, OutputLine[]> | undefined { return this.editing ? this.live?.outputs : undefined; }
    get editing(): boolean { return this.live !== undefined && this.live.cellId === this.notebook.current.id; }
    get iterationFocus(): { line: number; offset: number; nextLine: number } | undefined {
        if (!this.editing || !this.live || this.focusedIteration === undefined) return undefined;
        const text = this.live.outputs.get(this.focusedIteration)?.find(output => !output.error)?.text;
        if (!text) return undefined;
        const suffix = text.indexOf(' · iteration');
        return { line: this.focusedIteration, offset: suffix < 0 ? text.length : suffix,
            nextLine: Math.min((this.focusedThroughLine ?? this.focusedIteration) + 1,
                this.notebook.current.source.split('\n').length) };
    }
    get status(): string | undefined {
        if (this.evaluatingStatus) return this.evaluatingStatus;
        if (!this.editing || !this.live) return undefined;
        return this.focusedIteration !== undefined
            ? '←/→ select · Esc edit · ^L run all'
            : /^\s*for\s/m.test(this.notebook.current.source) ? 'Eval · ^G loop · Esc edit · ^L run all'
            : 'Enter try · ^L run all';
    }

    clear(): void { this.live = undefined; this.clearIterationFocus(); }

    invalidatePreviews(): void {
        this.live?.outputs.clear();
        this.live?.prefixes.clear();
        this.clearIterationFocus();
    }

    async begin(source: string): Promise<boolean> {
        if (this.live && !this.notebook.cells.some(cell => cell.id === this.live!.cellId)) this.clear();
        if (!this.enabled || this.live || source.includes('\n')
            || !/^\s*(?:if\s+.+|for(?:\s.*)?)$/.test(source)) return false;
        const existing = !this.notebook.atPrompt;
        this.live = {
            source: `${source.trim()}\n  `,
            outputs: new Map(), prefixes: new Map(), iterations: new Map(), slowLines: new Set(),
            cellId: this.notebook.current.id, existing,
            originalSource: existing ? source : undefined,
        };
        this.clearIterationFocus();
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
        this.clearIterationFocus();
        this.notebook.toPrompt();
        if (!live.existing) this.notebook.replace('');
        this.setSuggestion('');
    }

    async rerun(): Promise<boolean> {
        if (this.live && !this.editing) return false;
        if (!this.live && !this.beginExisting()) return false;
        const live = this.live!;
        live.source = this.notebook.current.source;
        const line = selectedLine(live.source, this.notebook.cursor);
        const header = isIterationHeader(live.source.split('\n')[line - 1]);
        await this.update(true, header ? line : line - 1);
        this.clearIterationFocus();
        this.placeCursorAtLineEnd(line - 1);
        if (header) this.focusIteration(line);
        this.render();
        return true;
    }

    leavePreview(): boolean {
        if (!this.editing || !this.live?.existing) return false;
        this.clear();
        this.setSuggestion('');
        return true;
    }

    async selectIteration(): Promise<boolean> {
        if (this.live && !this.editing) return false;
        if (!this.live && !this.beginExisting()) return false;
        const current = currentLineNumber(this.notebook);
        const header = enclosingIterationLine(this.notebook.current.source, 0, current - 1);
        if (header === undefined) return false;
        await this.update(false, Math.max(header, current - 1));
        return this.focusIterationFromBody();
    }

    async forcePreview(): Promise<boolean> {
        if (!this.editing || !this.live) return false;
        this.notebook.formatCurrentLine(line => this.session.format(line));
        const source = this.notebook.current.source;
        const currentLine = source.slice(0, this.notebook.cursor).split('\n').length - 1;
        if (!/\n[\t ]*$/.test(source)) this.notebook.preparePrompt(line => this.session.format(line));
        await this.update(true, currentLine + 1);
        this.clearIterationFocus();
        this.placeCursorAfterLine(currentLine);
        this.render();
        return true;
    }

    async moveIteration(direction: number): Promise<boolean> {
        const live = this.live;
        const line = this.focusedIteration;
        if (!this.editing || !live || line === undefined) return false;
        const iteration = live.iterations.get(line) ?? 0;
        const next = Math.max(0, iteration + direction);
        if (next === iteration) return true;
        live.iterations.set(line, next);
        live.outputs.clear();
        live.prefixes.clear();
        await this.update(false, this.focusedThroughLine ?? line);
        this.render();
        return true;
    }

    releaseIteration(): boolean {
        if (!this.editing || this.focusedIteration === undefined) return false;
        this.clearIterationFocus();
        this.updateSuggestion();
        this.render();
        return true;
    }

    focusIterationFromBody(header?: number): boolean {
        if (!this.editing || !this.live || this.focusedIteration !== undefined) return false;
        const current = currentLineNumber(this.notebook);
        const line = header ?? enclosingIterationLine(this.notebook.current.source, 0, current - 1);
        if (line !== undefined) this.focusIteration(line, header === undefined ? Math.max(line, current - 1) : line);
        if (this.focusedIteration === undefined) return false;
        this.render();
        return true;
    }

    async submit(): Promise<LiveSubmitResult> {
        const live = this.live;
        if (!this.editing || !live) return 'absent';
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
            this.clearIterationFocus();
            this.setSuggestion('');
            if (live.existing) {
                this.notebook.replayFrom = this.notebook.active;
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
            const line = currentLineNumber(this.notebook) - 1;
            const selected = statements.find(statement => {
                const range = statement.$cstNode?.range;
                return range && range.start.line <= line && range.end.line >= line;
            });
            if (!selected || !isIfStatement(selected) && !isForStatement(selected)) return false;
        } catch { return false; }
        this.live = {
            source, outputs: new Map(), prefixes: new Map(), iterations: new Map(), slowLines: new Set(),
            cellId: this.notebook.current.id,
            existing: true, originalSource: source,
        };
        this.clearIterationFocus();
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

    private focusIteration(line: number, throughLine = line): void {
        if (!this.live || !isIterationHeader(this.notebook.current.source.split('\n')[line - 1])
            || !this.live.outputs.get(line)?.some(output => !output.error)) return;
        this.focusedIteration = line;
        this.focusedThroughLine = throughLine;
    }

    private clearIterationFocus(): void {
        this.focusedIteration = undefined;
        this.focusedThroughLine = undefined;
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

function currentLineNumber(notebook: Notebook): number {
    return notebook.current.source.slice(0, notebook.cursor).split('\n').length;
}

function isIterationHeader(line = ''): boolean {
    return /^\s*for\s+.+\s+in\s+.+$/.test(line);
}
