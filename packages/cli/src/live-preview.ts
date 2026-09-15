import { EMPTY_CELL, addLine, isComplete } from './repl-input.js';
import type { Execution } from './repl-session.js';
import type { LiveFunctionSession } from './live-function.js';

type Preview = (source: string) => Execution | Promise<Execution>;

/** Builds and evaluates isolated prefixes of a function while it is being written. */
export class LivePreviewRunner {
    constructor(private readonly preview: Preview) {}

    async update(live: LiveFunctionSession, source: string, reset = false, throughLine?: number): Promise<void> {
        if (live.skipped || live.values.length !== live.parameters.length) return;
        if (reset) {
            live.outputs.clear();
            live.prefixes.clear();
        }
        const completed = completedBodies(source, live.existing, throughLine);
        const changed = completed.some(item => live.prefixes.has(item.line) && live.prefixes.get(item.line) !== item.body)
            || [...live.prefixes].some(([line]) => !completed.some(item => item.line === line));
        if (changed) {
            live.outputs.clear();
            live.prefixes.clear();
        }
        for (const item of completed) {
            if (live.outputs.has(item.line)) continue;
            const result = await this.preview(livePreviewSource(live, item.body));
            live.outputs.set(item.line, result.output);
            live.prefixes.set(item.line, item.body);
        }
    }
}

function completedBodies(source: string, existing: boolean, throughLine?: number): { line: number; body: string }[] {
    const lines = source.split('\n');
    const bodyEnd = existing && lines.at(-1)?.trim() === 'end' ? lines.length - 1 : lines.length;
    let state = EMPTY_CELL;
    const completed: { line: number; body: string }[] = [];
    for (let index = 1; index < bodyEnd; index++) {
        const line = lines[index];
        if (!line.trim()) continue;
        state = addLine(state, line.replace(/^  /, '').trimEnd(), true);
        if (!isComplete(state)) continue;
        if (throughLine === undefined || index + 1 <= throughLine)
            completed.push({ line: index + 1, body: lines.slice(1, index + 1).join('\n') });
        state = EMPTY_CELL;
    }
    return completed;
}

export function livePreviewSource(live: LiveFunctionSession, body: string): string {
    const lines = body.split('\n');
    const last = [...lines].reverse().find(line => line.trim())?.trim() ?? '';
    let fallback = '';
    if (!/^return\b/.test(last) && !/^yield\b/.test(last)) {
        const assignment = /^\s*([A-Za-z][A-Za-z0-9_]*)(?:\s+.*?)?\s*(?:=|\+=|-=|\*=|\*\*=|\/=|\/\/=|%=|and=|or=|xor=)/;
        const lastAssignment = assignment.exec(last)?.[1];
        if (lastAssignment) fallback = `\n  return ${lastAssignment}`;
        else if (last && !/^(?:if|elif|else|for|try|catch|finally|end|break|continue)\b/.test(last)) {
            let at = lines.length - 1;
            while (at >= 0 && !lines[at].trim()) at--;
            lines[at] = lines[at].replace(last, `return ${last}`);
        } else {
            const assigned = [...lines].reverse().map(line => assignment.exec(line)?.[1]).find(Boolean);
            fallback = `\n  return ${assigned ?? '0'}`;
        }
    }
    const call = [...live.values.map(value => `(${value})`), live.name].join(' ');
    return `${live.header}\n${lines.join('\n')}${fallback}\nend\n${call}`;
}
