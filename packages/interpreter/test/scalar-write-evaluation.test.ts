import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type NativeFunction } from '../src/index.js';
import { noteArrayBinding } from '../src/array-storage.js';
const native = (call: NativeFunction['call']): NativeFunction => ({ kind: 'function', name: 'rhs', arities: [1], monadicRank: 'all', call });

describe.each([false, true])('single-cell writes with interpreted RHS (compilation=%s)', compilation => {
    const create = () => new Interpreter(() => {}, { compilation, integerLoopCompilation: false });
    it('resumes a user function exactly once', () => {
        const r = create(); let calls = 0;
        r.variables.set('rhs', native(() => { calls++; return 7n; }));
        try {
            expect(r.execute('fun X nested\n return X rhs\nend\nA = array 3 4\nI = 0\nA I += 1 nested\nA I')).toBe(10n);
            expect(calls).toBe(1);
        } finally { r.dispose(); }
    });
    it('retains aliases created by the RHS before copy-on-write', () => {
        const r = create();
        r.variables.set('rhs', native(() => { noteArrayBinding(r.variables.get('A')!); r.variables.set('Snapshot', r.variables.get('A')!); return 8n; }));
        try {
            r.execute('A = array 1 2\nI = 0\nA I = 1 rhs');
            expect(formatValue(r.variables.get('Snapshot')!)).toBe('1 2');
            expect(formatValue(r.variables.get('A')!)).toBe('8 2');
        } finally { r.dispose(); }
    });
    it('passes array results to shape validation without repeating the RHS', () => {
        const r = create(); let calls = 0;
        r.execute('A = array 1 2\nValues = array 7 8\nI = 0');
        r.variables.set('rhs', native(() => { calls++; return r.variables.get('Values')!; }));
        try {
            expect(() => r.execute('A I = 1 rhs')).toThrow('assignment shape mismatch');
            expect(calls).toBe(1);
            expect(formatValue(r.variables.get('A')!)).toBe('1 2');
        } finally { r.dispose(); }
    });
    it.each(['-1', '2', '999999999999999999999999999'])('checks invalid index %s before the RHS', index => {
        const r = create(); let calls = 0;
        r.variables.set('rhs', native(() => { calls++; throw Error('RHS must not run'); }));
        try {
            r.execute(`A = array 1 2\nI = ${index}`);
            expect(() => r.execute('A I = 1 rhs')).toThrow(/index|bounds/);
            expect(calls).toBe(0);
        } finally { r.dispose(); }
    });
    it('does not commit a failed RHS', () => {
        const r = create();
        try {
            r.execute('A = array 1 2\nI = 0');
            expect(() => r.execute('A I += A 99')).toThrow('out of bounds');
            expect(formatValue(r.variables.get('A')!)).toBe('1 2');
        } finally { r.dispose(); }
    });
    it('preserves exact wide integers loaded from an array', () => {
        const r = create();
        try { expect(r.execute('A = array 1 2\nB = array 9007199254740993 3\nI = 0\nA I += B I\nA I')).toBe(9007199254740994n); }
        finally { r.dispose(); }
    });
    it('reads a shared RHS before replacing the destination cell', () => {
        const r = create();
        try {
            r.execute('A = array 1 2\nBefore = A\nI = 0\nA I += Before I');
            expect(formatValue(r.variables.get('Before')!)).toBe('1 2');
            expect(formatValue(r.variables.get('A')!)).toBe('2 2');
        } finally { r.dispose(); }
    });
});
