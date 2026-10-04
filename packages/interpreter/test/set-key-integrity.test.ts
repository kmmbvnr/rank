import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';

function debugRun(source: string) {
    const signal = new Int32Array(new SharedArrayBuffer(12));
    const runtime = new Interpreter();
    return withInterrupt(signal, () => runtime.execute(source), () => {});
}

const modified = /set element was modified after it was added/;

describe('set element key stability in debug runs', () => {
    it('rejects a record changed while a set holds it', () => {
        expect(() => debugRun([
            'use algo', 'A = record', '  .value = 1', 'end', 'S = new set', 'S add A',
            'A .value = 2', 'A in S',
        ].join('\n'))).toThrow(modified);
    });

    it('catches changes made through an alias, a function argument and a compound assignment', () => {
        const prefix = ['use algo', 'A = record', '  .value = 1', 'end', 'S = new set', 'S add A'];
        expect(() => debugRun([...prefix, 'B = A', 'B .value = 2', 'A in S'].join('\n'))).toThrow(modified);
        expect(() => debugRun([...prefix, 'A .value += 1', 'A in S'].join('\n'))).toThrow(modified);
        const bump = ['use algo', 'fun bump R', '  R .value = 5', '  return 0', 'end', ...prefix.slice(1), 'A bump', 'A in S'];
        expect(() => debugRun(bump.join('\n'))).toThrow(modified);
    });

    it('catches a change to a nested record that contributes to the key', () => {
        expect(() => debugRun([
            'use algo', 'Inner = record', '  .n = 1', 'end', 'A = record', '  .inner = Inner', 'end',
            'S = new set', 'S add A', 'Inner .n = 2', 'A in S',
        ].join('\n'))).toThrow(modified);
    });

    it('catches an element of a counter', () => {
        expect(() => debugRun([
            'use algo', 'A = record', '  .value = 1', 'end', 'C = new counter', 'C add A',
            'A .value = 2', 'A in C',
        ].join('\n'))).toThrow(/counter element was modified after it was added/);
    });

    it('allows removing an element, changing it and adding it again', () => {
        expect(debugRun([
            'use algo', 'A = record', '  .value = 1', 'end', 'S = new set', 'S add A',
            'S remove A', 'A .value = 2', 'S add A', 'A in S',
        ].join('\n'))).toBe(true);
    });

    it('leaves unmodified records, scalar sets and unrelated records alone', () => {
        expect(debugRun([
            'use algo', 'A = record', '  .value = 1', 'end', 'B = record', '  .value = 1', 'end',
            'S = new set', 'S add A', 'T = new set', 'T add 3', 'B .value = 9', 'A in S',
        ].join('\n'))).toBe(true);
    });

    it('rebuilds a cached record key after a field write', () => {
        const runtime = new Interpreter();
        expect(runtime.execute([
            'use algo', 'A = record', '  .value = 1', 'end', 'S = new set', 'S add A', 'A in S',
        ].join('\n'))).toBe(true);
        runtime.execute('A .value = 2');
        expect(runtime.execute('A in S')).toBe(false);
        runtime.execute('A .value = 1');
        expect(runtime.execute('A in S')).toBe(true);
    });

    it('does not check ordinary runs', () => {
        const runtime = new Interpreter();
        expect(runtime.execute([
            'use algo', 'A = record', '  .value = 1', 'end', 'S = new set', 'S add A',
            'A .value = 2', 'A in S',
        ].join('\n'))).toBe(false);
    });
});
