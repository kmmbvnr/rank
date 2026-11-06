import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { sequence } from '../src/sequence.js';

for (const compilation of [false, true]) describe(`stream last, compilation=${compilation}`, () => {
    it('consumes an unknown single-pass source once', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        let starts = 0, reads = 0;
        const iterator = (function* () { for (const value of [1n, 2n, 3n]) { reads++; yield value; } })();
        runtime.variables.set('Stream', sequence({ name: 'single-pass', size: { kind: 'unknown' },
            iterate() { starts++; return iterator; } }));
        try {
            expect(runtime.execute('use sequences\nStream last')).toBe(3n);
            expect(starts).toBe(1);
            expect(reads).toBe(3);
        } finally { runtime.dispose(); }
    });
    it('preserves an empty stream error', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        runtime.variables.set('Stream', sequence({ name: 'empty', size: { kind: 'unknown' }, *iterate() {} }));
        try { expect(() => runtime.execute('use sequences\nStream last')).toThrow('sequence is empty'); }
        finally { runtime.dispose(); }
    });
    it('propagates a source error without replay', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        let starts = 0;
        runtime.variables.set('Stream', sequence({ name: 'failure', size: { kind: 'unknown' },
            *iterate() { starts++; yield 1n; throw Error('source failed'); } }));
        try {
            expect(() => runtime.execute('use sequences\nStream last')).toThrow('source failed');
            expect(starts).toBe(1);
        } finally { runtime.dispose(); }
    });
});
