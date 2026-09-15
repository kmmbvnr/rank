import { EMPTY_CELL, addLine, cellSource, closeCell, type CellState } from './repl-input.js';
import type { Execution, OutputLine } from './repl-session.js';
import type { LiveFunctionSession } from './live-function.js';

type Preview = (source: string) => Execution | Promise<Execution>;

interface PreviewState {
    readonly outputs: Map<number, OutputLine[]>;
    readonly prefixes: Map<number, string>;
}

const REACHED = 'RankReplPreviewReached';
const VALUE = 'RankReplPreviewValue';
const SKIPPED = '.replPreviewSkipped';
const BRANCH_RUNS = '.replPreviewBranchRuns';

/** Builds and evaluates isolated prefixes while a block is being written. */
export class LivePreviewRunner {
    constructor(private readonly preview: Preview) {}

    async updateFunction(
        live: LiveFunctionSession, source: string, reset = false, throughLine?: number,
    ): Promise<void> {
        if (live.skipped || live.values.length !== live.parameters.length) return;
        await this.update(live, source, 1, functionBodyEnd(source, live.existing),
            (text, target) => functionPreviewSource(live, text, target), reset, throughLine);
    }

    async updateConditional(
        state: PreviewState, source: string, reset = false, throughLine?: number,
    ): Promise<void> {
        await this.update(state, source, 0, conditionalBodyEnd(source),
            conditionalPreviewSource, reset, throughLine);
    }

    private async update(
        state: PreviewState,
        source: string,
        start: number,
        end: number,
        build: (source: string, target: number) => string,
        reset: boolean,
        throughLine?: number,
    ): Promise<void> {
        if (reset) {
            state.outputs.clear();
            state.prefixes.clear();
        }
        const lines = source.split('\n');
        const previews = previewTargets(source, start, end, throughLine).map(target => ({
            line: target + 1,
            source: build(source, target),
            branch: /^(?:if|elif)\b/.test(lines[target].trim()) ? 'condition' as const
                : lines[target].trim() === 'else' ? 'else' as const : undefined,
        }));
        const changed = previews.some(item => state.prefixes.has(item.line)
                && state.prefixes.get(item.line) !== item.source)
            || [...state.prefixes].some(([line]) => !previews.some(item => item.line === line));
        if (changed) {
            state.outputs.clear();
            state.prefixes.clear();
        }
        for (const item of previews) {
            if (state.outputs.has(item.line)) continue;
            const result = await this.preview(item.source);
            state.outputs.set(item.line, displayOutput(result.output, item.branch));
            state.prefixes.set(item.line, item.source);
        }
    }
}

function previewTargets(source: string, start: number, end: number, throughLine?: number): number[] {
    const lines = source.split('\n');
    let state = EMPTY_CELL;
    const targets: number[] = [];
    for (let index = start; index < end; index++) {
        const line = lines[index];
        if (!line.trim()) continue;
        const closingBlock = line.trim() === 'end' ? state.blocks.at(-1) : undefined;
        state = addLine(state, line.trim(), index + 1 < end);
        const first = line.trim().split(/\s+/, 1)[0];
        const resultLine = !['end', 'break', 'continue', 'for', 'try', 'catch', 'finally'].includes(first)
            || first === 'end' && closingBlock !== undefined;
        if (state.pending === '' && resultLine
            && (throughLine === undefined || index + 1 <= throughLine)) targets.push(index);
    }
    return targets;
}

function functionBodyEnd(source: string, existing: boolean): number {
    const lines = source.split('\n');
    return existing && lines.at(-1)?.trim() === 'end' ? lines.length - 1 : lines.length;
}

function conditionalBodyEnd(source: string): number {
    const lines = source.split('\n');
    return lines.at(-1)?.trim() === 'end' ? lines.length - 1 : lines.length;
}

function displayOutput(output: OutputLine[], branch?: 'condition' | 'else'): OutputLine[] {
    if (branch === 'else') {
        if (output.some(line => !line.error && line.text === BRANCH_RUNS)) {
            return [{ text: 'branch runs', error: false }];
        }
        const errors = output.filter(line => line.error);
        return errors.length ? errors : [{ text: 'branch skipped', error: false }];
    }
    if (output.some(line => !line.error && line.text === SKIPPED)) {
        return branch === 'condition' ? [{ text: 'not evaluated · branch skipped', error: false }] : [];
    }
    if (branch === 'condition' && output.length === 0) {
        return [{ text: 'not evaluated · branch skipped', error: false }];
    }
    if (branch !== 'condition') return output;
    let result = output.length - 1;
    while (result >= 0 && output[result].error) result -= 1;
    return output.map((line, index) => index !== result ? line : line.text === 'true'
        ? { ...line, text: 'true · branch runs' }
        : line.text === 'false' ? { ...line, text: 'false · branch skipped' } : line);
}

function functionPreviewSource(live: LiveFunctionSession, source: string, target: number): string {
    const lines = source.split('\n');
    let state: CellState = EMPTY_CELL;
    for (let index = 1; index < target; index++) {
        if (lines[index].trim()) state = addLine(state, skippedReturn(lines[index].trim()), true);
    }
    state = lines[target].trim() === 'end'
        ? addClosedBlockResult(state, lines, 1, target)
        : addTarget(state, lines[target].trim(), true);
    const body = cellSource(closeCell(state)).split('\n').map(line => `  ${line}`).join('\n');
    const call = [...live.values.map(value => `(${value})`), live.name].join(' ');
    return [
        live.header,
        `  ${REACHED} = false`,
        body,
        `  if ${REACHED}`,
        `    return ${VALUE}`,
        '  end',
        `  return ${SKIPPED}`,
        'end',
        call,
    ].join('\n');
}

function conditionalPreviewSource(source: string, target: number): string {
    const lines = source.split('\n');
    let state: CellState = EMPTY_CELL;
    for (let index = 0; index < target; index++) {
        if (lines[index].trim()) state = addLine(state, lines[index].trim(), true);
    }
    state = lines[target].trim() === 'end'
        ? addClosedBlockResult(state, lines, 0, target)
        : addTarget(state, lines[target].trim(), false);
    return [
        `${REACHED} = false`,
        cellSource(closeCell(state)),
        `if ${REACHED}`,
        `  ${VALUE}`,
        'end',
    ].join('\n');
}

function skippedReturn(line: string): string {
    return /^return\b/.test(line) ? `return ${SKIPPED}` : line;
}

function addTarget(state: CellState, line: string, insideFunction: boolean): CellState {
    const condition = /^(if|elif)\s+(.+)$/.exec(line);
    if (condition) {
        state = addLine(state, line);
        state = addResult(state, 'true');
        state = addLine(state, 'else');
        state = addResult(state, 'false');
        return addLine(state, 'end');
    }
    if (line === 'else') {
        state = addLine(state, line);
        state = addResult(state, BRANCH_RUNS);
        return addLine(state, 'end');
    }
    const returned = /^return\s+(.+)$/.exec(line);
    if (insideFunction && returned) {
        state = addLine(state, `${VALUE} = (${returned[1]})`);
        return addLine(state, `${REACHED} = true`);
    }
    const yielded = /^yield\s+(.+)$/.exec(line);
    if (insideFunction && yielded) {
        state = addLine(state, `${VALUE} = (${yielded[1]})`);
        return addLine(state, `${REACHED} = true`);
    }
    const assignment = /^([A-Za-z][A-Za-z0-9_]*)(?:\s+.*?)?\s*(?:=|\+=|-=|\*=|\*\*=|\/=|\/\/=|%=|and=|or=|xor=)/.exec(line);
    if (assignment) {
        state = addLine(state, line);
        state = addLine(state, `${VALUE} = ${assignment[1]}`);
        return addLine(state, `${REACHED} = true`);
    }
    state = addLine(state, `${VALUE} = (${line})`);
    return addLine(state, `${REACHED} = true`);
}

function addResult(state: CellState, value: string): CellState {
    state = addLine(state, `${VALUE} = ${value}`);
    return addLine(state, `${REACHED} = true`);
}

function addClosedBlockResult(state: CellState, lines: string[], start: number, target: number): CellState {
    state = addLine(state, 'end');
    const assignment = /^\s*([A-Za-z][A-Za-z0-9_]*)(?:\s+.*?)?\s*(?:=|\+=|-=|\*=|\*\*=|\/=|\/\/=|%=|and=|or=|xor=)/;
    const name = lines.slice(start, target).reverse().map(line => assignment.exec(line)?.[1]).find(Boolean);
    return addResult(state, name ?? '0');
}

/** Kept as a public helper for callers that build a one-line function preview. */
export function livePreviewSource(live: LiveFunctionSession, body: string): string {
    const source = `${live.header}\n${body}`;
    return functionPreviewSource(live, source, source.split('\n').length - 1);
}
