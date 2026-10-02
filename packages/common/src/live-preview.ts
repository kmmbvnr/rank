import { EMPTY_CELL, addLine, cellSource, closeCell, scanLine, tokenize, type CellState } from './repl-input.js';
import type { Execution, OutputLine } from './repl-session.js';
import type { LiveFunctionSession } from './live-function.js';

type Preview = (source: string, syntheticNames: ReadonlySet<string>) => Execution | Promise<Execution>;
interface LoopSummary { readonly names: readonly string[]; readonly sources: readonly string[] }
interface GeneratedPreview {
    readonly source: string;
    readonly syntheticNames: ReadonlySet<string>;
    readonly summary?: LoopSummary;
}

interface PreviewState {
    readonly outputs: Map<number, OutputLine[]>;
    readonly prefixes: Map<number, string>;
    readonly iterations: Map<number, number>;
    readonly slowLines?: Set<number>;
}

export interface LivePreviewOptions {
    timeoutMs?: number;
    progressDelayMs?: number;
    onProgress?: (status: string | undefined) => void;
    interrupt?: () => void;
}

interface IterationHeader { readonly names: string; readonly name: string; readonly iterable: string }
type Control = 'condition' | 'else' | 'while' | { kind: 'iteration'; name: string; index: number };

const REACHED = 'RankReplPreviewReached';
const VALUE = 'RankReplPreviewValue';
const SKIPPED = '.replPreviewSkipped';
const BRANCH_RUNS = '.replPreviewBranchRuns';
const LOOP_RUNS = '.replPreviewLoopRuns';
const ITERATION = 'RankReplPreviewIteration';
const COUNT = 'RankReplPreviewCount';
const SUMMARY = 'RankReplPreviewSummary';

/** Builds and evaluates isolated prefixes while a block is being written. */
export class LivePreviewRunner {
    private readonly updates = new WeakMap<PreviewState, number>();
    constructor(private readonly preview: Preview, private readonly options: LivePreviewOptions = {}) {}

    async updateFunction(
        live: LiveFunctionSession, source: string, reset = false, throughLine?: number,
    ): Promise<void> {
        if (live.skipped || live.values.length !== live.parameters.length) return;
        await this.update(live, source, 1, functionBodyEnd(source, live.existing),
            (text, target) => functionPreviewSource(live, text, target), reset, throughLine, live.name);
    }

    async updateConditional(
        state: PreviewState, source: string, reset = false, throughLine?: number,
    ): Promise<void> {
        await this.update(state, source, 0, conditionalBodyEnd(source),
            (text, target) => conditionalPreviewSource(state, text, target), reset, throughLine);
    }

    private async update(
        state: PreviewState,
        source: string,
        start: number,
        end: number,
        build: (source: string, target: number) => GeneratedPreview,
        reset: boolean,
        throughLine?: number,
        functionName?: string,
    ): Promise<void> {
        const update = (this.updates.get(state) ?? 0) + 1;
        this.updates.set(state, update);
        if (reset) {
            state.outputs.clear();
            state.prefixes.clear();
            state.slowLines?.clear();
        }
        const lines = source.split('\n');
        const previews = previewTargets(source, start, end, throughLine).map(target => ({
            line: target + 1,
            target,
            ...build(source, target),
            control: controlAt(lines[target].trim(), target + 1, state.iterations),
            recursive: lineCallsFunction(lines[target].trim(), functionName),
            generator: closesGeneratorLoop(lines, start, target),
        }));
        const changed = previews.some(item => state.prefixes.has(item.line)
                && state.prefixes.get(item.line) !== item.source)
            || [...state.prefixes].some(([line]) => !previews.some(item => item.line === line));
        if (changed) {
            state.outputs.clear();
            state.prefixes.clear();
        }
        let priorRecursion = false;
        for (const item of previews) {
            if (state.outputs.has(item.line)) {
                if (item.recursive) priorRecursion = true;
                continue;
            }
            if (item.recursive) {
                state.outputs.set(item.line, [{ text: 'recursive call', error: false }]);
                state.prefixes.set(item.line, item.source);
                priorRecursion = true;
                continue;
            }
            if (item.generator) {
                state.outputs.set(item.line, [{ text: 'generator loop', error: false }]);
                state.prefixes.set(item.line, item.source);
                continue;
            }
            if (state.slowLines?.has(item.line)) {
                state.outputs.set(item.line, [{ text: 'timeout (>1.5s) · ^R to evaluate', error: false }]);
                state.prefixes.set(item.line, item.source);
                continue;
            }
            const timeoutMs = this.options.timeoutMs ?? 1500;
            const progressDelayMs = this.options.progressDelayMs ?? 300;
            const started = performance.now();
            let timer: ReturnType<typeof setInterval> | undefined;
            let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
            let timedOut = false;
            if (this.options.onProgress) {
                timer = setInterval(() => {
                    const elapsed = performance.now() - started;
                    if (elapsed >= progressDelayMs) {
                        this.options.onProgress?.(`Evaluating preview… ${(elapsed / 1000).toFixed(1)}s · ^C cancel`);
                    }
                }, 100);
            }
            if (timeoutMs > 0 && this.options.interrupt) {
                timeoutTimer = setTimeout(() => {
                    timedOut = true;
                    this.options.interrupt?.();
                }, timeoutMs);
            }
            let result: Execution;
            try {
                result = await this.preview(item.source, item.syntheticNames);
                if (item.summary && !result.interrupted && !result.output.some(line => line.error)) {
                    const values: OutputLine[][] = [];
                    for (const source of item.summary.sources) {
                        const value = await this.preview(source, item.syntheticNames);
                        if (value.interrupted || value.output.some(line => line.error)) { result = value; break; }
                        values.push(value.output);
                    }
                    if (values.length === item.summary.sources.length)
                        result = { ...result, output: loopSummary(item.summary.names, values, result.output) };
                }
            } finally {
                if (timer) clearInterval(timer);
                if (timeoutTimer) clearTimeout(timeoutTimer);
                this.options.onProgress?.(undefined);
            }
            if (this.updates.get(state) !== update) return;
            if (timedOut || result.interrupted) {
                state.slowLines?.add(item.line);
                const text = timedOut ? 'timeout (>1.5s) · ^R to evaluate' : 'cancelled · ^R to evaluate';
                state.outputs.set(item.line, [{ text, error: false }]);
                state.prefixes.set(item.line, item.source);
                continue;
            }
            state.slowLines?.delete(item.line);
            const isRecError = priorRecursion && result.output.some(line => line.error && !line.text.includes('[Syntax]'));
            const output = isRecError
                ? [{ text: 'recursive call', error: false }]
                : displayOutput(result.output, item.control).map(previewError);
            state.outputs.set(item.line, output);
            state.prefixes.set(item.line, item.source);
        }
    }
}

/**
 * A bare `for` that yields never ends on its own, and the closing `end` previews
 * by counting the iterations, so that count would never come back.
 */
function closesGeneratorLoop(lines: string[], start: number, target: number): boolean {
    const loop = closingLoop(lines, start, target);
    if (loop === undefined || lines[loop].trim() !== 'for') return false;
    return lines.slice(loop + 1, target).some(line => /^yield\b/.test(line.trim()));
}

function lineCallsFunction(line: string, name?: string): boolean {
    if (!name) return false;
    const tokens = tokenize(line);
    return tokens.some(token => token.kind === 'word' && token.text === name);
}

function previewTargets(source: string, start: number, end: number, throughLine?: number): number[] {
    const lines = source.split('\n');
    let state = EMPTY_CELL;
    const targets: number[] = [];
    for (let index = start; index < end; index++) {
        const line = lines[index];
        if (!line.trim()) continue;
        const closingBlock = line.trim() === 'end' ? state.blocks.at(-1) : undefined;
        // A conditional's branch lines already show their results; only a loop's `end` adds the state after all iterations.
        state = addLine(state, line.trim(), index + 1 < end);
        const first = line.trim().split(/\s+/, 1)[0];
        const resultLine = !['end', 'break', 'continue', 'try', 'catch', 'finally'].includes(first)
            || first === 'end' && closingBlock === 'for';
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

function displayOutput(output: OutputLine[], control?: Control): OutputLine[] {
    if (control === 'else') {
        if (output.some(line => !line.error && line.text === BRANCH_RUNS)) {
            return [{ text: 'branch runs', error: false }];
        }
        const errors = output.filter(line => line.error);
        return errors.length ? errors : [{ text: 'branch skipped', error: false }];
    }
    if (typeof control === 'object') {
        const errors = output.filter(line => line.error);
        if (errors.length) return errors;
        let result = output.length - 1;
        while (result >= 0 && output[result].error) result -= 1;
        if (result < 0) return [{ text: `iteration ${control.index + 1} · loop skipped`, error: false }];
        return output.map((line, index) => index === result
            ? { ...line, text: `${control.name} = ${line.text} · iteration ${control.index + 1}` } : line);
    }
    if (control === 'while') {
        if (output.some(line => !line.error && line.text === LOOP_RUNS)) return [{ text: 'loop runs', error: false }];
        if (output.some(line => !line.error && line.text === SKIPPED) || output.length === 0)
            return [{ text: 'loop skipped', error: false }];
        let result = output.length - 1;
        while (result >= 0 && output[result].error) result -= 1;
        return output.map((line, index) => index !== result ? line : line.text === 'true'
            ? { ...line, text: 'true · loop runs' }
            : line.text === 'false' ? { ...line, text: 'false · loop skipped' } : line);
    }
    if (output.some(line => !line.error && line.text === SKIPPED)) {
        return control === 'condition' ? [{ text: 'not evaluated · branch skipped', error: false }] : [];
    }
    if (control === 'condition' && output.length === 0) {
        return [{ text: 'not evaluated · branch skipped', error: false }];
    }
    if (control !== 'condition') return output;
    let result = output.length - 1;
    while (result >= 0 && output[result].error) result -= 1;
    return output.map((line, index) => index !== result ? line : line.text === 'true'
        ? { ...line, text: 'true · branch runs' }
        : line.text === 'false' ? { ...line, text: 'false · branch skipped' } : line);
}

function functionPreviewSource(live: LiveFunctionSession, source: string, target: number): GeneratedPreview {
    const lines = source.split('\n');
    const active = enclosingLoopLines(lines, 1, target);
    omitCompletedLoop(active, lines, 1, target);
    const closing = closingLoop(lines, 1, target);
    let state: CellState = EMPTY_CELL;
    for (let index = 1; index < target; index++) {
        if (!lines[index].trim()) continue;
        if (active.has(index)) {
            state = addActiveLoop(state, skippedReturn(lines[index].trim()), index + 1,
                live.iterations.get(index + 1) ?? 0);
        } else if (index === closing) state = addCountedLoop(state, skippedReturn(lines[index].trim()));
        else state = addLine(state, skippedReturn(lines[index].trim()), true);
    }
    const call = [...live.values.map(value => `(${value})`), live.name].join(' ');
    const program = (final: CellState, result = VALUE): string => {
        const body = cellSource(closeCell(final)).split('\n').map(line => `  ${line}`).join('\n');
        return [
            live.header,
            `  ${REACHED} = false`,
            `  ${ITERATION} = 0`,
            body,
            `  if ${reachedCondition(active, lines)}`,
            `    return ${result}`,
            '  end',
            `  return ${SKIPPED}`,
            'end',
            call,
        ].join('\n');
    };
    const syntheticNames = previewSyntheticNames(active, lines);
    if (closing === undefined) {
        return { source: program(addTarget(state, lines[target].trim(), true,
            live.iterations.get(target + 1) ?? 0)), syntheticNames };
    }
    const closed = addLine(state, 'end');
    const names = loopOuterNames(lines, 1, closing, target, live.parameters);
    return { source: program(addResult(closed, COUNT, SUMMARY), SUMMARY),
        syntheticNames: new Set([...syntheticNames, COUNT, SUMMARY]),
        summary: { names, sources: names.map(name => program(addResult(closed, name, SUMMARY), SUMMARY)) } };
}

function conditionalPreviewSource(preview: PreviewState, source: string, target: number): GeneratedPreview {
    const lines = source.split('\n');
    const active = enclosingLoopLines(lines, 0, target);
    omitCompletedLoop(active, lines, 0, target);
    const closing = closingLoop(lines, 0, target);
    let state: CellState = EMPTY_CELL;
    for (let index = 0; index < target; index++) {
        if (!lines[index].trim()) continue;
        if (active.has(index)) {
            state = addActiveLoop(state, lines[index].trim(), index + 1,
                preview.iterations.get(index + 1) ?? 0);
        } else if (index === closing) state = addCountedLoop(state, lines[index].trim());
        else state = addLine(state, lines[index].trim(), true);
    }
    const program = (final: CellState, result = VALUE): string => [
        `${REACHED} = false`,
        `${ITERATION} = 0`,
        cellSource(closeCell(final)),
        `if ${reachedCondition(active, lines)}`,
        `  ${result}`,
        'end',
    ].join('\n');
    const syntheticNames = previewSyntheticNames(active, lines);
    if (closing === undefined) {
        return { source: program(addTarget(state, lines[target].trim(), false,
            preview.iterations.get(target + 1) ?? 0)), syntheticNames };
    }
    const closed = addLine(state, 'end');
    const names = loopOuterNames(lines, 0, closing, target, []);
    return { source: program(addResult(closed, COUNT, SUMMARY), SUMMARY),
        syntheticNames: new Set([...syntheticNames, COUNT, SUMMARY]),
        summary: { names, sources: names.map(name => program(addResult(closed, name, SUMMARY), SUMMARY)) } };
}

/**
 * A preview returns the value it reached, which a generator cannot do, so an
 * earlier `yield` becomes a plain evaluation of the item it would have emitted.
 */
function skippedReturn(line: string): string {
    if (/^return\b/.test(line)) return `return ${SKIPPED}`;
    const yielded = /^yield\s+(.+)$/.exec(line);
    return yielded ? `${VALUE} = (${yielded[1]})` : line;
}

function addTarget(state: CellState, line: string, insideFunction: boolean, iteration: number): CellState {
    if (state.pending) {
        line = `${state.pending} ${line}`;
        state = { ...state, pending: '' };
    }
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
    const binding = iterationHeader(line);
    if (binding) {
        state = addLine(state, `${ITERATION} = 0`);
        state = addLine(state, line);
        state = addLine(state, `if ${ITERATION} equal ${iteration}`);
        state = addResult(state, binding.name === '#' ? ITERATION : binding.name);
        state = addLine(state, 'break');
        state = addLine(state, 'end');
        state = addLine(state, `${ITERATION} += 1`);
        return addLine(state, 'end');
    }
    const whileLoop = /^for(?:\s+(.+))?$/.exec(line);
    if (whileLoop) {
        if (!whileLoop[1]) return addResult(state, LOOP_RUNS);
        state = addLine(state, `if ${whileLoop[1]}`);
        state = addResult(state, 'true');
        state = addLine(state, 'else');
        state = addResult(state, 'false');
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

function addResult(state: CellState, value: string, into = VALUE): CellState {
    state = addLine(state, `${into} = ${value}`);
    return addLine(state, `${REACHED} = true`);
}

const ASSIGNMENT = /^([A-Za-z][A-Za-z0-9_]*)(?:\s+.*?)?\s*(=|\+=|-=|\*=|\*\*=|\/=|\/\/=|%=|and=|or=|xor=)/;

/** The line of the loop that the `end` at `target` closes, if it closes one. */
function closingLoop(lines: string[], start: number, target: number): number | undefined {
    if (lines[target]?.trim() !== 'end') return undefined;
    const closing = openBlocks(lines, start, target).at(-1);
    return closing?.kind === 'for' ? closing.line : undefined;
}

function addCountedLoop(state: CellState, header: string): CellState {
    state = addLine(state, `${COUNT} = 0`, true);
    state = addLine(state, header, true);
    return addLine(state, `${COUNT} += 1`);
}

/**
 * Names the loop body assigns that were already bound in a block still open at
 * the loop. Names first bound inside the loop end with it, so they are skipped.
 */
function loopOuterNames(
    lines: string[], start: number, loop: number, end: number, parameters: readonly string[],
): string[] {
    const scopes: Set<string>[] = [new Set(parameters)];
    for (let index = start; index < loop; index++) {
        const text = lines[index].trim();
        if (!text) continue;
        const scan = scanLine(text);
        for (let count = 0; count < scan.closes; count++) if (scopes.length > 1) scopes.pop();
        const assigned = ASSIGNMENT.exec(text);
        if (assigned?.[2] === '=') scopes.at(-1)!.add(assigned[1]);
        for (let count = 0; count < scan.opens.length; count++) scopes.push(new Set());
    }
    const visible = new Set(scopes.flatMap(scope => [...scope]));
    const names: string[] = [];
    for (let index = loop + 1; index < end; index++) {
        const name = ASSIGNMENT.exec(lines[index].trim())?.[1];
        if (name && visible.has(name) && !names.includes(name)) names.push(name);
    }
    return names;
}

function loopSummary(names: readonly string[], values: OutputLine[][], counted: OutputLine[]): OutputLine[] {
    const last = (output: OutputLine[]): string | undefined =>
        output.filter(line => !line.error).at(-1)?.text.replace(/\s*\n\s*/g, ' ');
    const count = last(counted);
    if (count === undefined || counted.some(line => !line.error && line.text === SKIPPED)) return [];
    const parts = names.flatMap((name, index) => {
        const value = last(values[index]);
        return value === undefined ? [] : [`${name} = ${value}`];
    });
    const total = Number(count);
    parts.push(`${count} ${total === 1 ? 'iteration' : 'iterations'}`);
    return [{ text: parts.join(' · '), error: false }];
}

/** Generated previews number their own lines, so a line reference would point at the wrong place. */
function previewError(line: OutputLine): OutputLine {
    if (!line.error) return line;
    const strip = (text: string): string => text
        .replace(/ inside the block that ends at line \d+/g, ' inside a block that has ended')
        .replace(/ (?:at|on) line \d+/g, '');
    return { ...line, text: strip(line.text),
        ...line.inlineText === undefined ? {} : { inlineText: strip(line.inlineText) } };
}

/** Kept as a public helper for callers that build a one-line function preview. */
export function livePreviewSource(live: LiveFunctionSession, body: string): string {
    const source = `${live.header}\n${body}`;
    return functionPreviewSource(live, source, source.split('\n').length - 1).source;
}

function controlAt(line: string, number: number, iterations: ReadonlyMap<number, number>): Control | undefined {
    if (/^(?:if|elif)\b/.test(line)) return 'condition';
    if (line === 'else') return 'else';
    const binding = iterationHeader(line);
    if (binding) return { kind: 'iteration', name: binding.name, index: iterations.get(number) ?? 0 };
    if (/^for(?:\s|$)/.test(line)) return 'while';
    return undefined;
}

function iterationHeader(line: string): IterationHeader | undefined {
    const match = /^for\s+([A-Za-z#][A-Za-z0-9_#]*(?:\s+[A-Za-z#][A-Za-z0-9_#]*)*)\s+in\s+(.+)$/.exec(line);
    if (!match) return undefined;
    return { names: match[1], name: match[1].split(/\s+/)[0], iterable: match[2] };
}

function addActiveLoop(state: CellState, line: string, number: number, iteration: number): CellState {
    const binding = iterationHeader(line);
    if (binding) {
        const counter = iterationCounter(number);
        state = addLine(state, `${counter} = -1`, true);
        state = addLine(state, `${iterationSelected(number)} = false`, true);
        state = addLine(state, line, true);
        state = addLine(state, `${counter} += 1`);
        state = addLine(state, `if ${counter} greater ${iteration}`);
        state = addLine(state, 'break');
        state = addLine(state, 'end');
        state = addLine(state, `${iterationSelected(number)} = ${counter} equal ${iteration}`);
        return addLine(state, `${REACHED} = false`);
    }
    const condition = /^for(?:\s+(.+))?$/.exec(line)?.[1];
    state = addLine(state, `if ${condition ?? 'true'}`, true);
    return addLine(state, `${REACHED} = false`);
}

function iterationCounter(number: number): string { return `${ITERATION}${number}`; }
function iterationSelected(number: number): string { return `${ITERATION}Selected${number}`; }

function previewSyntheticNames(active: ReadonlySet<number>, lines: readonly string[]): ReadonlySet<string> {
    const names = new Set([REACHED, VALUE, ITERATION]);
    for (const line of active) if (iterationHeader(lines[line].trim())) {
        names.add(iterationCounter(line + 1));
        names.add(iterationSelected(line + 1));
    }
    return names;
}

function reachedCondition(active: ReadonlySet<number>, lines: readonly string[]): string {
    const selected = [...active]
        .filter(line => iterationHeader(lines[line].trim()))
        .map(line => iterationSelected(line + 1));
    return [REACHED, ...selected].join(' and ');
}

function enclosingLoopLines(lines: string[], start: number, target: number): Set<number> {
    return new Set(openBlocks(lines, start, target)
        .filter(item => item.kind === 'for').map(item => item.line));
}

function openBlocks(lines: string[], start: number, target: number): { kind: string; line: number }[] {
    const stack: { kind: string; line: number }[] = [];
    for (let index = start; index < target; index++) {
        const text = lines[index].trim();
        if (!text) continue;
        const scan = scanLine(text);
        for (let count = 0; count < scan.closes; count++) stack.pop();
        for (const kind of scan.opens) stack.push({ kind, line: index });
    }
    return stack;
}

function omitCompletedLoop(active: Set<number>, lines: string[], start: number, target: number): void {
    if (lines[target]?.trim() !== 'end') return;
    const closing = openBlocks(lines, start, target).at(-1);
    if (closing?.kind === 'for') active.delete(closing.line);
}

/** Finds the innermost collection loop containing the selected source line. */
export function enclosingIterationLine(source: string, start: number, target: number): number | undefined {
    const lines = source.split('\n');
    if (iterationHeader(lines[target]?.trim() ?? '')) return target + 1;
    const loop = openBlocks(lines, start, target).reverse()
        .find(block => block.kind === 'for' && iterationHeader(lines[block.line].trim()));
    return loop === undefined ? undefined : loop.line + 1;
}
