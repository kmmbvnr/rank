import { expect, it } from 'vitest';
import { DebugSession, debugExecutionPoint, withInterrupt, type InterruptSignal, type PauseSnapshot } from '../src/interrupt.js';

function host() {
    const words = [0, 0, 0];
    const signal: InterruptSignal = {
        length: 3,
        load: index => words[index],
        store: (index, value) => { words[index] = value; },
        exchange: (index, value) => { const previous = words[index]; words[index] = value; return previous; },
        wait: () => { throw new Error('pause callback must resume'); },
    };
    return { words, signal };
}
const point = (line: number) => debugExecutionPoint({ source: 'example.ra', line, loops: [], depth: 0, topLevel: true });
function observe(session: DebugSession) {
    const { words, signal } = host(), lines: (number | undefined)[] = [];
    withInterrupt(signal, () => { point(1); point(2); }, pause => {
        lines.push(pause.line);
        words[1] = 0;
    }, session);
    return lines;
}

it('keeps independent host sessions from sharing breakpoints', () => {
    const first = new DebugSession(), second = new DebugSession();
    const points = [{ source: 'example.ra', line: 1 }];
    first.setBreakpoints(points);
    points[0].line = 2;
    second.setBreakpoints([{ source: 'example.ra', line: 2 }]);
    expect(observe(first)).toEqual([1]);
    expect(observe(second)).toEqual([2]);
    expect(observe(first)).toEqual([1]);
    expect(observe(new DebugSession())).toEqual([]);
});

it.each([false, true])('restores outer stepping after a nested session (throws=%s)', throws => {
    const outer = new DebugSession(), inner = new DebugSession();
    outer.setBreakpoints([{ source: 'example.ra', line: 1 }]);
    inner.setBreakpoints([{ source: 'example.ra', line: 2 }]);
    const { words, signal } = host();
    const pauses: PauseSnapshot[] = [];
    withInterrupt(signal, () => { point(1); point(2); point(3); }, pause => {
        pauses.push(pause);
        if (pause.line === 1) {
            expect(observe(inner)).toEqual([2]);
            if (throws) expect(() => withInterrupt(host().signal, () => { throw new Error('nested'); }, undefined, inner)).toThrow('nested');
            words[2] = 2;
        }
        words[1] = 0;
    }, outer);
    expect(pauses.map(pause => pause.line)).toEqual([1, 2]);
    expect(observe(outer)).toEqual([1]);
});
