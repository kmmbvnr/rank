import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Interpreter, isNativeFunction, isRankArray} from '../src/index.js';
import {readArrayItem, typedArray} from '../src/array-storage.js';

const source = readFileSync(new URL('../../../demos/euler/438_integerpart.ra', import.meta.url), 'utf8');
function polynomial(roots: readonly number[]) {
    let coefficients = [1];
    for (const root of roots) {
        const next = Array(coefficients.length + 1).fill(0) as number[];
        coefficients.forEach((coefficient, i) => { next[i] += coefficient; next[i + 1] -= root * coefficient; });
        coefficients = next;
    }
    return coefficients;
}
const valueAt = (coefficients: readonly number[], x: number) => coefficients.reduce((value, coefficient) => value * x + coefficient, 0);

// Deflate integer roots exactly, then count strict sign changes in the
// remaining intervals. This uses neither endpoint derivatives nor differences.
function valid(coefficients: readonly number[]) {
    const degree = coefficients.length - 1;
    for (let x = 1; x <= degree + 1; x++) {
        const sign = (degree + 1 - x) % 2 ? -1 : 1;
        if (sign * valueAt(coefficients, x) < 0) return false;
    }
    let remaining = [...coefficients];
    const used = new Set<number>();
    for (let x = 1; x <= degree + 1; x++) {
        while (remaining.length > 1 && valueAt(remaining, x) === 0) {
            if (x > degree || used.has(x)) return false;
            used.add(x);
            const divided = [remaining[0]];
            for (let i = 1; i < remaining.length - 1; i++) divided.push(remaining[i] + x * divided[i - 1]);
            remaining = divided;
        }
    }
    for (let interval = 1; interval <= degree; interval++) {
        if (!used.has(interval) && valueAt(remaining, interval) * valueAt(remaining, interval + 1) >= 0) return false;
    }
    return true;
}
function brute(degree: number) {
    const near = polynomial(Array.from({length: degree}, (_, i) => i + 1));
    const far = polynomial(Array.from({length: degree}, (_, i) => i + 2));
    const lower = near.slice(1).map((value, i) => i % 2 ? value : far[i + 1] + 1);
    const upper = near.slice(1).map((value, i) => i % 2 ? far[i + 1] - 1 : value);
    const coefficients = [1, ...Array(degree).fill(0)] as number[];
    const accepted: number[][] = [];
    const prefixes: number[][] = [];
    const visit = (index: number) => {
        if (index === degree) prefixes.push(coefficients.slice(0, degree));
        if (index > degree) {
            if (valid(coefficients)) accepted.push([...coefficients]);
            return;
        }
        for (let value = lower[index - 1]; value <= upper[index - 1]; value++) {
            coefficients[index] = value;
            visit(index + 1);
        }
    };
    visit(1);
    return {accepted, prefixes, total: accepted.reduce((sum, row) => sum + row.slice(1).reduce((a, b) => a + Math.abs(b), 0), 0)};
}
const small = [undefined, ...Array.from({length: 4}, (_, i) => brute(i + 1))];

function fallingPrefix(coefficients: readonly number[]) {
    const degree = coefficients.length;
    const remainder = [...coefficients];
    const result: number[] = [];
    for (let i = 0; i < degree; i++) {
        const coefficient = remainder[i];
        result.push(coefficient);
        const basis = polynomial(Array.from({length: degree - i}, (_, j) => j));
        for (let j = 0; j < degree - i; j++) remainder[i + j] -= coefficient * basis[j];
    }
    return result;
}

describe('Euler 438 exact half-open root intervals', () => {
    it('reproduces the statement by ordinary-coefficient enumeration and root deflation', () => {
        expect(small[4]!.accepted).toHaveLength(12);
        expect(small[4]!.total).toBe(2087);
        expect(valid(polynomial([1, 2, 3, 4]))).toBe(true);
        expect(valid(polynomial([2, 3, 4, 5]))).toBe(false);
        expect(valid(polynomial([1, 1, 3, 4]))).toBe(false);
    });
    it.each([{}, {numberLoopCompilation: false}, {compilation: false}])('preserves small degrees, boundary roots and fixtures: %j', options => {
        for (const degree of [0, 1, 2, 3, 4, 5, 6]) {
            const runtime = new Interpreter(() => {}, {...options, args: [`--n=${degree}`]});
            try {
                runtime.execute(source);
                const answer = degree === 0 ? 0 : degree <= 4 ? small[degree]!.total : degree === 5 ? 355734 : 332262442;
                expect(runtime.variables.get('Answer'), `N=${degree}`).toBe(BigInt(answer));
                if (degree <= 4) expect(runtime.variables.get('Cnt')).toBe(BigInt(degree ? small[degree]!.accepted.length : 1));
            } finally { runtime.dispose(); }
        }
    });
    it('matches aggregate counts and weights over all Vieta-bounded quartic prefixes', () => {
        const runtime = new Interpreter(() => {}, {args: ['--n=4']});
        try {
            runtime.execute(source);
            const rows = small[4]!.prefixes.map(fallingPrefix);
            const input = typedArray(Int32Array.from(rows.flat()), [rows.length, 4]);
            const score = runtime.variables.get('score');
            if (!score || !isNativeFunction(score)) throw Error('missing score');
            const result = score.call([input]);
            if (!isRankArray(result)) throw Error('expected totals');
            expect(readArrayItem(result, 0)).toBe(12n);
            expect(readArrayItem(result, 1)).toBe(2087n);
        } finally { runtime.dispose(); }
    });
    it('retains the full default answer and polynomial count', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(2046409616809n);
            expect(runtime.variables.get('Cnt')).toBe(24883200n);
        } finally { runtime.dispose(); }
    }, 30_000);
});
