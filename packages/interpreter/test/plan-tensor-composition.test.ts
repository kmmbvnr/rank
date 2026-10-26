import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, parse, withDemandBudget, DemandBudgetExhausted } from '../src/index.js';
import { isFunctionStatement } from '@arrrank/language';
import { demandValue } from '../src/plan.js';
import { materializedArrayItems, ownedArray, derivedArray, readArrayItem } from '../src/array-storage.js';
import { registerScalarView } from '../src/integer-view.js';
import { Operators } from '../src/operators.js';
import { RankError } from '../src/errors.js';
import { constructingTensorPlan, reduceTensorMap, tensorPlanScope } from '../src/tensor-map.js';
import { withInterrupt } from '../src/interrupt.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import type { RankArray } from '../src/value.js';

const stages = "use sequences\nSquared' = Input * Input\nShifted' = Squared + 1\nTotal' = Shifted sum";

describe.each([false, true])('native checked plan composition (compilation=%s)', compilation => {
    function runtime() {
        let entries = 0;
        const sources: string[] = [];
        const output: string[] = [];
        const diagnostics = new RuntimeDiagnostics();
        const host = new Interpreter(text => output.push(text), { compilation,
            onTensorKernelExecuted: () => entries++, onTensorKernelCompiled: source => sources.push(source) });
        host.variables.set('Input', ownedArray([1n, 2n, 3n]));
        return { host, sources, output, diagnostics, entries: () => entries,
            execute: (source: string) => diagnostics.run(() => host.execute(source)) };
    }

    it('fuses separate checked stages and retains code rather than arrays or results', () => {
        const { host, execute, entries, sources, diagnostics } = runtime();
        try {
            execute(stages);
            expect(entries()).toBe(0);
            expect(sources).toEqual([]);
            const intermediate = diagnostics.run(() => demandValue(host.variables.get('Shifted')!));
            if (!isRankArray(intermediate)) throw Error('expected native tensor');
            expect(materializedArrayItems(intermediate)).toBeUndefined();
            expect(diagnostics.cellsComputed).toBe(0);
            expect(execute('Total')).toBe(17n);
            expect(execute('Total')).toBe(17n);
            expect(entries()).toBe(compilation ? 2 : 0);
            if (compilation) {
                expect(sources).toHaveLength(1);
                expect(sources[0].match(/for \(/g)).toHaveLength(1);
                expect(sources[0]).not.toContain('new Array');
                expect(diagnostics.cellsComputed).toBe(0);
            } else expect(diagnostics.cellsComputed).toBe(12);
        } finally { host.dispose(); }
    });

    it('also fuses a direct consumer after producer demand has restored its scope', () => {
        const { host, execute, entries, sources } = runtime();
        try {
            execute(stages);
            expect(execute('Shifted sum')).toBe(17n);
            expect(execute('Shifted sum')).toBe(17n);
            expect(entries()).toBe(compilation ? 2 : 0);
            expect(sources).toHaveLength(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('composes escaped function-local plans while executing the function body immediately', () => {
        const { host, execute, entries, output } = runtime();
        try {
            execute(`use sequences
use io
fun X' transform
 "entered" print
 Squared' = X * X
 Shifted' = Squared + 1
 return Shifted
end
Total' = Input transform sum`);
            expect(output).toEqual(['entered']);
            expect(entries()).toBe(0);
            expect(execute('Total')).toBe(17n);
            expect(execute('Total')).toBe(17n);
            expect(entries()).toBe(compilation ? 2 : 0);
            expect(output).toEqual(['entered']);
        } finally { host.dispose(); }
    });

    it('shares code at a function expression site without retaining earlier arguments or checks', () => {
        const { host, execute, entries, sources } = runtime();
        try {
            execute(`use sequences
fun X' total
 Squared' = X * X
 Shifted' = Squared + 1
 return Shifted sum
end
Other = array 4 5`);
            expect(execute('Input total')).toBe(17n);
            expect(execute('Other total')).toBe(43n);
            expect(entries()).toBe(compilation ? 2 : 0);
            expect(sources).toHaveLength(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('preserves captured versions across source and stage rebinding', () => {
        const { host, execute, entries } = runtime();
        try {
            execute(stages);
            execute("Input = array 9 9 9\nSquared' = Input * 100");
            expect(execute('Total')).toBe(17n);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('keeps eager retention as completed writable storage', () => {
        const { host, execute } = runtime();
        try {
            execute(stages);
            execute('Saved = Shifted\nSaved 0 = 100');
            const saved = host.variables.get('Saved')!;
            if (!isRankArray(saved)) throw Error('expected stored array');
            expect(materializedArrayItems(saved)).toEqual([100n, 5n, 10n]);
            expect(execute('Saved sum')).toBe(115n);
            expect(execute('Total')).toBe(17n);
        } finally { host.dispose(); }
    });

    it('stops lowering at an ordinary binding rather than reusing its old producer', () => {
        const { host, execute, entries, sources } = runtime();
        try {
            execute(stages);
            execute("Saved = Squared\nAfter' = Saved + 1");
            expect(entries()).toBe(compilation ? 1 : 0);
            expect(execute('After sum')).toBe(17n);
            expect(entries()).toBe(compilation ? 2 : 0);
            if (compilation) expect(sources.at(-1)!).not.toContain('tensor:operator-guard:*');
        } finally { host.dispose(); }
    });

    it('does not use stale metadata after a host replaces a stored source reader', () => {
        const { host, execute, entries } = runtime();
        const reads: number[] = [];
        const input = host.variables.get('Input') as RankArray;
        try {
            execute(stages);
            Object.defineProperty(input, 'itemAt', { value: (index: number) => {
                reads.push(index); return BigInt(index + 10);
            } });
            expect(execute('Total')).toBe(368n);
            expect(reads).toEqual([0, 0, 1, 1, 2, 2]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('also rejects the replaced reader in direct tensor and arithmetic-fold entry guards', () => {
        const { host, execute, entries } = runtime();
        const reads: number[] = [];
        const input = host.variables.get('Input') as RankArray;
        try {
            execute("use sequences\nTotal' = (Input * 2 + 1) sum");
            Object.defineProperty(input, 'itemAt', { value: (index: number) => {
                reads.push(index); return BigInt(index + 10);
            } });
            expect(execute('Total')).toBe(69n);
            expect(reads).toEqual([0, 1, 2]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('preserves exact arithmetic and multidimensional broadcasting across stages', () => {
        const { host, execute, entries } = runtime();
        const large = 2n ** 90n + 1n;
        host.variables.set('Input', ownedArray([large, 2n, -large, 4n], [2, 2]));
        host.variables.set('Row', ownedArray([3n, 5n]));
        try {
            execute("use sequences\nScaled' = Input * Row\nShifted' = Scaled + 1\nTotal' = Shifted sum");
            expect(execute('Total')).toBe(34n);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('preserves real accumulation order and mixed numeric promotion across stages', () => {
        const { host, execute, entries } = runtime();
        try {
            execute("use sequences\nValues = array 10000000000000000.0 1.0 (-10000000000000000.0)\nScaled' = Values * 1.0\nShifted' = Scaled + 0.0\nAnswer' = Shifted sum");
            expect(execute('Answer')).toBe(0);
            execute("Real = array 1.5 2.5 3.5\nMixed' = Input * Real\nAdjusted' = Mixed - 0.5");
            expect(execute('Adjusted sum')).toBe(15.5);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('preserves nonfinite real results when the native numeric guard declines', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('Input', ownedArray([NaN, -0, 2]));
        try {
            execute("use sequences\nScaled' = Input * 1.0\nShifted' = Scaled + 0.0\nTotal' = Shifted sum");
            expect(execute('Total')).toBeNaN();
            expect(execute('Total')).toBeNaN();
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('preserves empty multidimensional geometry without reading nonexistent cells', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('Input', ownedArray([], [2, 0]));
        try {
            execute(stages);
            const shifted = demandValue(host.variables.get('Shifted')!);
            if (!isRankArray(shifted)) throw Error('expected empty tensor');
            expect(shifted.shape).toEqual([2, 0]);
            expect(execute('Total')).toBe(0n);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('retains intermediate binding errors rather than bypassing them', () => {
        const { host, execute, entries } = runtime();
        try {
            execute('use sequences\nSquared = array "text"');
            execute(stages);
            expect(() => execute('Total')).toThrowError(/Squared/);
            expect(() => execute('Total')).toThrowError(/Squared/);
            expect(entries()).toBe(0);
            // A failed demand must not leave the native construction scope active.
            const ordinary = execute('Input * 2');
            if (!ordinary || !isRankArray(ordinary)) throw Error('expected array');
            expect(materializedArrayItems(ordinary)).toEqual([2n, 4n, 6n]);
        } finally { host.dispose(); }
    });

    it('declines opaque inputs without extra reads and never replays failed prefixes', () => {
        const { host, execute, entries } = runtime();
        const reads: number[] = [];
        let fail = true;
        host.variables.set('Input', { kind: 'array', shape: [3], containsFiles: false,
            get items(): never { throw Error('must not inspect host storage'); },
            itemAt(index) {
                reads.push(index);
                if (index === 1 && fail) { fail = false; throw new RankError('first traversal'); }
                return BigInt(index + 1);
            },
        });
        try {
            execute("use sequences\nScaled' = Input * 2\nShifted' = Scaled + 1\nTotal' = Shifted sum");
            expect(reads).toEqual([]);
            expect(() => execute('Total')).toThrowError('first traversal');
            expect(execute('Total')).toBe(15n);
            expect(reads).toEqual([0, 1, 0, 1, 2]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('preserves partial indexing and late errors outside the supported native domain', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('Input', ownedArray([2n, 0n, 3n]));
        try {
            execute("use sequences\nDivided' = 12 // Input\nShifted' = Divided + 1\nTotal' = Shifted sum");
            expect(execute('Shifted 0')).toBe(7n);
            expect(() => execute('Total')).toThrowError('division by zero');
            expect(() => execute('Total')).toThrowError('division by zero');
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('rechecks cancellation budgets after code has been cached', () => {
        const { host, execute, entries } = runtime();
        host.variables.set('Input', ownedArray(Array.from({ length: 16384 }, () => 1n)));
        try {
            execute(stages);
            expect(execute('Total')).toBe(32768n);
            expect(() => withDemandBudget(20, () => execute('Total'))).toThrow(DemandBudgetExhausted);
            expect(execute('Total')).toBe(32768n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('disables an escaped native graph during inspection and resumes afterward', () => {
        const { host, execute, entries } = runtime();
        try {
            execute(stages);
            host.variables.set('Native', execute('Shifted')!);
            expect(execute('Native sum')).toBe(17n);
            const before = entries();
            const signal = new Int32Array(new SharedArrayBuffer(8 * 4));
            expect(withInterrupt(signal, () => execute('Native sum'), () => {})).toBe(17n);
            expect(entries()).toBe(before);
            expect(execute('Native sum')).toBe(17n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });
});

it('falls back under a restrictive code-generation policy and can compile on a later demand', () => {
    let entries = 0;
    const host = new Interpreter(undefined, { onTensorKernelExecuted: () => entries++ });
    host.variables.set('Input', ownedArray([1n, 2n, 3n]));
    try {
        host.execute(stages);
        const blocked = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw Error('CSP'); });
        try { expect(host.execute('Total')).toBe(17n); }
        finally { blocked.mockRestore(); }
        expect(entries).toBe(0);
        expect(host.execute('Total')).toBe(17n);
        expect(entries).toBe(1);
    } finally { host.dispose(); }
});

it('does not lend an outer plan compiler to a nested interpreter with compilation disabled', () => {
    let entries = 0;
    const outer = tensorPlanScope({ lookup: () => undefined, builtin: () => true }, () => true, () => entries++);
    const inner = new Interpreter(undefined, { compilation: false });
    try {
        expect(outer(() => inner.execute('use sequences\nfun X twice = X * 2\nA = array 1 2 3\n(A twice) sum'))).toBe(12n);
        expect(entries).toBe(0);
        expect(constructingTensorPlan()).toBe(false);
        const operators = new Operators(() => {}, () => undefined);
        inner.variables.set('Mapped', outer(() => operators.evaluateBinary('*', ownedArray([1n, 2n, 3n]), 2n)));
        expect(inner.execute('Mapped sum')).toBe(12n);
        expect(entries).toBe(0);
    } finally { inner.dispose(); }
});

it('publishes generated code before a compilation observer reenters the same kernel', () => {
    const definition = parse('fun A probe\n return (A * 2) sum\nend').statements[0];
    if (!isFunctionStatement(definition)) throw Error('expected function');
    let compilations = 0;
    let nested: unknown;
    let kernel: ReturnType<typeof compileTensorKernel>;
    const input = ownedArray([1n, 2n, 3n]);
    kernel = compileTensorKernel(definition.statements[0], { lookup: name => name === 'A' ? input : undefined,
        builtin: () => true, compiled() {
            if (++compilations === 1) nested = kernel!.run();
        } });
    expect(kernel?.run()).toBe(12n);
    expect(nested).toBe(12n);
    expect(compilations).toBe(1);
});

it('keeps per-cell contracts in order and supplies fresh checks to cached native code', () => {
    const sources: string[] = [];
    const seen: [number, bigint][] = [];
    let entries = 0, pass = 0;
    const withinPlan = tensorPlanScope({ lookup: () => undefined, builtin: () => true,
        compiled: source => sources.push(source) }, () => true, () => entries++);
    const operators = new Operators(() => {}, () => undefined);
    const run = () => withinPlan(() => {
        const current = ++pass;
        const input = ownedArray(current === 1 ? [1n, 2n, 3n] : [4n, 5n, 6n]);
        const mapped = operators.evaluateBinary('*', input, 2n) as RankArray;
        const checked = derivedArray(mapped.shape, [mapped], index => readArrayItem(mapped, index), true);
        registerScalarView(checked, mapped, index => index, { scalarCheck: true,
            linear: () => ({ offset: 0, stride: 1 }), check: cell => {
                seen.push([current, cell as bigint]);
                if (current === 1 && cell === 4n) throw new RankError('intermediate cell contract');
                return cell;
            } });
        return reduceTensorMap(checked, 'sum');
    });
    expect(() => run()).toThrowError('intermediate cell contract');
    expect(constructingTensorPlan()).toBe(false);
    expect(entries).toBe(0);
    expect(run()).toBe(30n);
    expect(seen).toEqual([[1, 2n], [1, 4n], [2, 8n], [2, 10n], [2, 12n]]);
    expect(sources).toHaveLength(1);
    expect(entries).toBe(1);
});
