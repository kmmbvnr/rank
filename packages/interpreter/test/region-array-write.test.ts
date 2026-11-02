import { describe, expect, it, vi } from 'vitest';
import { isArrayAssignmentStatement } from '@arrrank/language';
import { prepareRegionArrayWrite, type AssignmentContext } from '../src/eval/assignments.js';
import { createArraySnapshot, formatValue, parse, type RankValue } from '../src/index.js';
import { Operators } from '../src/operators.js';
import { checkpoint, withInterrupt } from '../src/interrupt.js';

function site() {
    const statement = parse('A I J = Value').statements[0];
    if (!isArrayAssignmentStatement(statement)) throw Error('expected write');
    let target: RankValue = createArraySnapshot([0n, 0n, 0n, 0n], [2, 2]);
    let onResolve: (() => void) | undefined;
    const compileAssign = vi.fn(() => (value: RankValue) => { target = value; });
    const unexpected = () => { throw Error('syntax must not be evaluated'); };
    const host: AssignmentContext = {
        evaluate: unexpected, defer: unexpected, compileDirect: unexpected,
        compileAssign, protect: unexpected,
        resolveVariable: () => { onResolve?.(); return target; },
        isStandardFunction: () => false, canConsumeBinding: () => false,
        checkArrayWrite: (_name, _target, values) => values,
        evaluateAddressParts: unexpected, select: unexpected,
        requireModule: unexpected, options: () => ({ compilation: true }),
        operators: new Operators(() => {}, () => undefined),
    };
    return {
        write: prepareRegionArrayWrite(statement, host),
        value: () => formatValue(target), compileAssign,
        onResolve: (callback?: () => void) => { onResolve = callback; },
    };
}

describe('prepared compiled-region array writes', () => {
    it('prepares once and reads current operands on every invocation', () => {
        const s = site();
        s.write([0n, 1n], () => 3n);
        s.write([1n, 0n], () => 7n);
        expect(s.value()).toBe('0 3 7 0');
        expect(s.compileAssign).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('restores operands after a nested write (fails=%s)', fails => {
        const s = site();
        s.onResolve(() => {
            s.onResolve();
            if (fails) expect(() => s.write([1n, 0n], () => { throw Error('nested'); })).toThrow('nested');
            else s.write([1n, 0n], () => 7n);
        });
        s.write([0n, 1n], () => 3n);
        expect(s.value()).toBe(fails ? '0 3 0 0' : '0 3 7 0');
    });

    it('checks selectors before RHS and recovers from exceptions', () => {
        const s = site(), rhs = vi.fn(() => 9n);
        expect(() => s.write([2n, 0n], rhs)).toThrow();
        expect(rhs).not.toHaveBeenCalled();
        expect(() => s.write([0n, 0n], () => { throw Error('RHS'); })).toThrow('RHS');
        expect(s.value()).toBe('0 0 0 0');
        s.write([1n, 1n], rhs);
        expect(s.value()).toBe('0 0 0 9');
    });

    it('cleans up on cancellation and accepts a subsequent write', () => {
        const s = site();
        expect(() => withInterrupt(new Int32Array([1]), () => s.write([0n, 1n], () => {
            checkpoint('test RHS', 1024);
            return 9n;
        }))).toThrow('Interrupted');
        expect(s.value()).toBe('0 0 0 0');
        s.write([1n, 0n], () => 5n);
        expect(s.value()).toBe('0 0 5 0');
    });
});
