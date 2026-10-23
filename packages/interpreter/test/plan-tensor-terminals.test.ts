import { describe, expect, it } from 'vitest';
import { Interpreter, withDemandBudget, DemandBudgetExhausted } from '../src/index.js';
import { ownedArray, derivedArray, readArrayItem } from '../src/array-storage.js';
import { registerScalarView } from '../src/integer-view.js';
import { Operators } from '../src/operators.js';
import { RankError } from '../src/errors.js';
import { reduceTensorMap, tensorPlanScope } from '../src/tensor-map.js';
import type { RankArray } from '../src/value.js';

describe.each([false, true])('checked native tensor terminals (compilation=%s)', compilation => {
    function runtime() {
        let entries = 0;
        const sources: string[] = [];
        const host = new Interpreter(() => {}, { compilation,
            onTensorKernelExecuted: () => entries++, onTensorKernelCompiled: source => sources.push(source) });
        host.variables.set('Input', ownedArray([1n, 2n, 3n]));
        return { host, sources, entries: () => entries };
    }

    it.each([['mean', 17 / 3], ['min', 2n], ['max', 10n]] as const)(
        'fuses %s over separate checked stages and recomputes each demand', (operation, expected) => {
            const { host, entries, sources } = runtime();
            try {
                host.execute(`use sequences\nuse stats\nSquared' = Input * Input\nShifted' = Squared + 1\nTotal' = Shifted ${operation}`);
                expect(entries()).toBe(0);
                expect(host.execute('Total')).toBe(expected);
                expect(host.execute('Total')).toBe(expected);
                expect(entries()).toBe(compilation ? 2 : 0);
                expect(sources).toHaveLength(compilation ? 1 : 0);
                if (compilation) {
                    expect(sources[0].match(/for \(/g)).toHaveLength(1);
                    expect(sources[0]).not.toContain('new Array');
                }
            } finally { host.dispose(); }
        },
    );

    it('keeps mean conversion order distinct from an exact integer sum', () => {
        const { host, entries } = runtime();
        const large = 2n ** 90n;
        host.variables.set('Input', ownedArray([large, 1n, -large]));
        try {
            host.execute("use stats\nScaled' = Input * 1\nShifted' = Scaled + 0");
            expect(host.execute('Shifted sum')).toBe(1n);
            expect(host.execute('Shifted mean')).toBe(0);
            expect(host.execute('Shifted min')).toBe(-large);
            expect(host.execute('Shifted max')).toBe(large);
            expect(entries()).toBe(compilation ? 4 : 0);
        } finally { host.dispose(); }
    });

    it('preserves signed-zero ties and NaN fallback for real extrema', () => {
        const { host, entries } = runtime();
        host.variables.set('Input', ownedArray([-0, 0]));
        try {
            host.execute("use stats\nScaled' = Input * 1.0\nNegated' = -Scaled");
            expect(Object.is(host.execute('Scaled min'), -0)).toBe(true);
            expect(Object.is(host.execute('Scaled max'), -0)).toBe(true);
            expect(Object.is(host.execute('Negated min'), 0)).toBe(true);
            expect(entries()).toBe(compilation ? 3 : 0);
            host.variables.set('Other', ownedArray([NaN, 2]));
            host.execute("Bad' = Other * 1.0");
            expect(host.execute('Bad min')).toBeNaN();
            expect(host.execute('Bad mean')).toBeNaN();
            expect(entries()).toBe(compilation ? 3 : 0);
        } finally { host.dispose(); }
    });

    it.each(['mean', 'min', 'max'])('retains empty %s errors and preceding retained values', operation => {
        const { host, entries } = runtime();
        host.variables.set('Input', ownedArray([], [2, 0]));
        try {
            host.execute(`use stats\nSquared' = Input * Input\nShifted' = Squared + 1\nTotal' = Shifted ${operation}\nSaved = 9`);
            expect(() => host.execute('Saved = Total')).toThrowError(/requires at least one value/);
            expect(() => host.execute('Total')).toThrowError(/requires at least one value/);
            expect(host.execute('Saved')).toBe(9n);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it.each([['count', 2n], ['any', true], ['all', false]] as const)(
        'fuses numeric comparison stages with %s', (operation, expected) => {
            const { host, entries } = runtime();
            try {
                host.execute(`use sequences\nSquared' = Input * Input\nShifted' = Squared + 1\nMask' = Shifted greater 4\nAnswer' = Mask ${operation}`);
                expect(host.execute('Answer')).toBe(expected);
                expect(host.execute('Answer')).toBe(expected);
                expect(entries()).toBe(compilation ? 2 : 0);
            } finally { host.dispose(); }
        },
    );

    it.each([
        ['less', 1n], ['greater', 1n], ['at most', 2n], ['at least', 2n], ['equal', 1n], ['not equal', 2n],
    ] as const)('preserves the %s comparison in a named mask', (operation, expected) => {
        const { host, entries } = runtime();
        try {
            host.execute(`use sequences\nShifted' = Input + 1\nMask' = Shifted ${operation} 3`);
            expect(host.execute('Mask count')).toBe(expected);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('composes boolean logic, not, and unary numeric signs', () => {
        const { host, entries } = runtime();
        try {
            host.execute(`use sequences
Positive' = +Input
Negative' = -Positive
Low' = Negative less -1
High' = Input greater 2
Both' = Low and High
Either' = Low or High
Different' = Low xor High
Inverted' = not Low`);
            expect(host.execute('Both count')).toBe(1n);
            expect(host.execute('Either count')).toBe(2n);
            expect(host.execute('Different count')).toBe(1n);
            expect(host.execute('Inverted count')).toBe(1n);
            expect(entries()).toBe(compilation ? 4 : 0);
        } finally { host.dispose(); }
    });

    it('preserves empty boolean identities', () => {
        const { host, entries } = runtime();
        host.variables.set('Input', ownedArray([], [2, 0]));
        try {
            host.execute("use sequences\nMask' = Input greater 2\nOther' = not Mask\nCombined' = Mask or Other");
            expect(host.execute('Combined any')).toBe(false);
            expect(host.execute('Combined all')).toBe(true);
            expect(host.execute('Combined count')).toBe(0n);
            expect(entries()).toBe(compilation ? 3 : 0);
        } finally { host.dispose(); }
    });

    it('treats inline and named masks as booleans in reductions', () => {
        const { host } = runtime();
        try {
            host.execute("use sequences\nuse stats\nShifted' = Input + 1\nMask' = Shifted greater 3");
            for (const operation of ['sum', 'mean']) {
                expect(() => host.execute(`Mask ${operation}`)).toThrowError(/boolean mask/);
            }
            expect(() => host.execute('(Shifted greater 3) mean')).toThrowError(/boolean mask/);
            expect(host.execute('Mask min')).toBe(false);
            expect(host.execute('Mask max')).toBe(true);
            expect(host.execute('Shifted filter greater 3 mean')).toBe(4);
        } finally { host.dispose(); }
    });

    it('does not probe opaque readers and any skips a late read failure', () => {
        const { host, entries } = runtime();
        const reads: number[] = [];
        host.variables.set('Input', { kind: 'array', shape: [3],
            get items(): never { throw Error('must not collect host'); },
            itemAt(index) { reads.push(index); if (index === 1) throw new RankError('late cell'); return 2n; },
        });
        try {
            host.execute("use sequences\nShifted' = Input + 1\nMask' = Shifted greater 0");
            expect(host.execute('Mask any')).toBe(true);
            expect(reads).toEqual([0]);
            expect(() => host.execute('Mask count')).toThrowError('late cell');
            expect(reads).toEqual([0, 0, 1]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it.each(['Mask any', '(Input + 1 greater 0) any'])(
        'keeps native any bounded independently of the full mask size: %s', expression => {
            const { host, entries } = runtime();
            host.variables.set('Input', ownedArray(Array.from({ length: 16384 }, () => 1n)));
            try {
                host.execute(`use sequences\nShifted' = Input + 1\nMask' = Shifted greater 0\nAnswer' = ${expression}`);
                expect(host.execute('Answer')).toBe(true);
                expect(withDemandBudget(100, () => host.execute('Answer'))).toBe(true);
                expect(() => withDemandBudget(100, () => host.execute('Mask count'))).toThrow(DemandBudgetExhausted);
                expect(entries()).toBe(compilation ? 2 : 0);
            } finally { host.dispose(); }
        },
    );

    it('still validates every gather index before a boolean demand can short-circuit', () => {
        const { host, entries } = runtime();
        try {
            host.execute("use sequences\nFlags = array true false\nIndices = array 0 9\nAnswer' = (Flags Indices) any");
            expect(() => host.execute('Answer')).toThrowError(/out of bounds/);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it.each(['0.0', '0'])('composes guarded arithmetic before a later division failure (threshold %s)', threshold => {
        const { host, entries } = runtime();
        const expectedEntries = compilation && threshold === '0.0' ? 1 : 0;
        host.variables.set('Input', ownedArray([2n, 0n, 4n]));
        try {
            host.execute(`use sequences
Quotients' = 12 // Input
Remainders' = Quotients mod 5
Powers' = Remainders ** 2
Real' = Powers / 2
Mask' = Real greater ${threshold}`);
            expect(host.execute('Mask any')).toBe(true);
            expect(entries()).toBe(expectedEntries);
            expect(() => host.execute('Mask count')).toThrowError('division by zero');
            expect(entries()).toBe(expectedEntries);
        } finally { host.dispose(); }
    });
});

it.each([['any', 1n, true], ['all', 0n, false]] as const)(
    'native %s stops before a later cell contract could fail', (operation, first, expected) => {
        let checked = 0, entries = 0;
        const withinPlan = tensorPlanScope({ lookup: () => undefined, builtin: () => true }, () => true, () => entries++);
        const operators = new Operators(() => {}, () => undefined);
        const value = withinPlan(() => {
            const mask = operators.evaluateBinary('greater', ownedArray([first, 2n, 3n]), 0n) as RankArray;
            const wrapper = derivedArray(mask.shape, [mask], index => readArrayItem(mask, index), true);
            registerScalarView(wrapper, mask, index => index, { scalarCheck: true,
                linear: () => ({ offset: 0, stride: 1 }), check: cell => {
                    if (++checked > 1) throw new RankError('late contract');
                    return cell;
                } });
            return reduceTensorMap(wrapper, operation);
        });
        expect(value).toBe(expected);
        expect(checked).toBe(1);
        expect(entries).toBe(1);
    },
);

it('does not establish a later stored operand contract ahead of an earlier failing check', () => {
    const seen: string[] = [];
    const withinPlan = tensorPlanScope({ lookup: () => undefined, builtin: () => true }, () => true, () => {});
    const operators = new Operators(() => {}, () => undefined);
    const checked = (source: RankArray, name: string, fails: boolean): RankArray => {
        const wrapper = derivedArray(source.shape, [source], index => readArrayItem(source, index), true);
        return registerScalarView(wrapper, source, index => index, { scalarCheck: true,
            linear: () => ({ offset: 0, stride: 1 }), check: cell => {
                seen.push(name);
                if (fails) throw new RankError('first contract');
                return cell;
            } });
    };
    expect(() => withinPlan(() => {
        const left = operators.evaluateBinary('*', ownedArray([1n, 2n]), 2n) as RankArray;
        const result = operators.evaluateBinary('+', checked(left, 'left', true),
            checked(ownedArray([1n, 2n]), 'right', false)) as RankArray;
        return reduceTensorMap(result, 'sum');
    })).toThrowError('first contract');
    expect(seen).toEqual(['left']);
});
