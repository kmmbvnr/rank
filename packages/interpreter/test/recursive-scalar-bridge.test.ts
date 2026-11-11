import { expect, it } from 'vitest';
import { recursiveScalarBridge } from '../src/jit/recursive-scalar-bridge.js';
import { numberOverflow } from '../src/jit/number-arithmetic.js';
import type { RankValue } from '../src/runtime/value.js';

function fixture(arity: number) {
    let depth = 0, hooks = 0, rejects = 0, failures = 0, successes = 0;
    const bridge = {
        enter: () => { depth++; }, leave: () => { depth--; },
        hook: () => { hooks++; }, allowed: () => true,
        rejectArguments: () => { rejects++; }, succeeded: () => { successes++; },
        failed: () => { failures++; },
        number: (...args: never[]): RankValue => args.reduce<number>((sum, value) => sum + value, 0),
        exact: (...args: never[]): RankValue => args.reduce<bigint>((sum, value) => sum + value, 0n),
        integerResult: true,
        recover: (error: unknown, _args: RankValue[]): { tail: RankValue[] } | { result: RankValue } => { throw error; },
    };
    return { bridge, run: () => recursiveScalarBridge(arity, bridge),
        counters: () => ({ depth, hooks, rejects, failures, successes }) };
}

it.each([0, 1, 2, 5, 16])('preserves %i positional arguments without losing exact wide inputs', arity => {
    const f = fixture(arity), call = f.run()!;
    const args = Array.from({ length: arity }, (_, index) => BigInt(index + 1));
    expect(call.length).toBe(arity);
    expect(call(...args)).toBe(BigInt(arity * (arity + 1) / 2));
    if (arity) {
        args[arity - 1] = 9007199254740993n;
        expect(call(...args)).toBe(args.reduce((sum, value) => sum + value, 0n));
        expect(f.counters().rejects).toBe(1);
    }
    expect(f.counters().depth).toBe(0);
    expect(f.counters().successes).toBe(1);
});
it('keeps code generation bounded', () => {
    expect(fixture(17).run()).toBeUndefined();
});
it('replays overflow exactly and unwinds failed exact calls once', () => {
    const f = fixture(2);
    f.bridge.number = () => { throw numberOverflow; };
    const call = f.run()!;
    expect(call(3n, 4n)).toBe(7n);
    expect(f.counters()).toEqual({ depth: 0, hooks: 1, rejects: 0, failures: 1, successes: 0 });
    const error = new Error('exact failure');
    f.bridge.exact = () => { throw error; };
    expect(() => call(3n, 4n)).toThrow(error);
    expect(f.counters().depth).toBe(0);
});
it('retains the frame across a same-function tail transfer', () => {
    const f = fixture(2), signal = {};
    f.bridge.allowed = () => false;
    f.bridge.exact = (...args: never[]) => { if (args[0] === 3n) throw signal; return args[0]; };
    f.bridge.recover = (error, args) => {
        expect(error).toBe(signal);
        expect(args).toEqual([3n, 4n]);
        expect(f.counters().depth).toBe(1);
        return { tail: [7n, 8n] };
    };
    expect(f.run()!(3n, 4n)).toBe(7n);
    expect(f.counters()).toEqual({ depth: 0, hooks: 2, rejects: 0, failures: 0, successes: 0 });
});
