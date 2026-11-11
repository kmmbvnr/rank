import { describe, expect, it } from 'vitest';
import { completed, runExecution } from '../src/execution.js';
import { checkPlan, demand, type RankPlan } from '../src/plan.js';
import { sequence } from '../src/sequence.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import type { RankValue } from '../src/value.js';

const dependencies = new Map<string, RankValue>();

describe('deferred result protocol', () => {
    it('constructs a fresh result for every demand without retaining failures', () => {
        let calls = 0;
        const plan: RankPlan = { kind: 'plan', dependencies, evaluate: () => {
            if (++calls === 1) throw new Error('first demand');
            return completed(BigInt(calls));
        } };
        expect(() => runExecution(demand(plan))).toThrowError('first demand');
        expect(runExecution(demand(plan))).toBe(2n);
        expect(runExecution(demand(plan))).toBe(3n);
    });

    it('returns native sequence planning capabilities without materialization', () => {
        let reads = 0;
        const native = sequence({ name: 'native plan', size: { kind: 'infinite' },
            *iterate() { reads++; yield 1n; }, at: index => index * 2n,
            contains: value => value === 42n,
        });
        const plan: RankPlan = { kind: 'plan', dependencies, evaluate: () => completed(native) };
        expect(runExecution(demand(plan))).toBe(native);
        expect(native.plan.at?.(21n)).toBe(42n);
        expect(native.plan.contains?.(42n)).toBe(true);
        expect(reads).toBe(0);
    });

    it('unwraps long chains on the execution stack and retries after cancellation', () => {
        let value: RankValue = 7n;
        let calls = 0;
        for (let index = 0; index < 10_000; index++) {
            const next: RankValue = value;
            value = { kind: 'plan', dependencies, evaluate: () => { calls++; return completed(next); } };
        }
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => runExecution(demand(value)))).toThrow(InterruptedError);
        const partial = calls;
        expect(partial).toBeLessThan(10_000);
        expect(runExecution(demand(value))).toBe(7n);
        expect(calls).toBe(partial + 10_000);
    });

    it('keeps deeply nested validation wrappers on a bounded host stack', () => {
        let checks = 0;
        let plan: RankPlan = { kind: 'plan', dependencies, evaluate: () => completed(7n) };
        for (let index = 0; index < 10_000; index++) plan = checkPlan(plan, value => { checks++; return value; });
        expect(runExecution(demand(plan))).toBe(7n);
        expect(checks).toBe(10_000);
        expect(runExecution(demand(plan))).toBe(7n);
        expect(checks).toBe(20_000);
    });

    it('resumes suspended plans without replaying their completed prefix', () => {
        const effects: string[] = [];
        const tail: RankPlan = { kind: 'plan', dependencies, evaluate: () => {
            effects.push('tail');
            return (function* () { yield { task: (function* () { effects.push('resume'); return 3n; })() }; return 7n; })();
        } };
        const head: RankPlan = { kind: 'plan', dependencies, evaluate: () => { effects.push('head'); return completed(tail); } };
        expect(runExecution(demand(head))).toBe(7n);
        expect(effects).toEqual(['head', 'tail', 'resume']);
        expect(runExecution(demand(head))).toBe(7n);
        expect(effects).toEqual(['head', 'tail', 'resume', 'head', 'tail', 'resume']);
    });

    it('rejects a cyclic result without caching the failure', () => {
        let calls = 0;
        const plan: RankPlan = { kind: 'plan', dependencies, evaluate: () => { calls++; return completed(plan); } };
        expect(() => runExecution(demand(plan))).toThrowError('cyclic deferred result');
        expect(() => runExecution(demand(plan))).toThrowError('cyclic deferred result');
        expect(calls).toBe(2);
    });
});
