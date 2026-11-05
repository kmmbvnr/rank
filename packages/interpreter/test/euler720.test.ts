import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { isRankArray } from '../src/value.js';

const source = readFileSync(new URL('../../../demos/euler/720_unpredictablepermutations.ra', import.meta.url), 'utf8');
function execute(bits: number, compilation: boolean) {
    const host = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => host.execute(source.replace('arg Bits integer = 25', `Bits = ${bits}`)));
        const cells = (name: string) => {
            const value = host.variables.get(name);
            if (!value || !isRankArray(value)) throw Error(`missing ${name}`);
            return Array.from({ length: value.shape[0] }, (_, i) => Number(readArrayItem(value, i)));
        };
        return { permutation: cells('Perm'), code: cells('Lehmer'), answer: host.variables.get('Answer'), diagnostics };
    } finally { host.dispose(); }
}

// Independent counts of smaller suffix values and exact factorial weights.
function rank(permutation: number[]) {
    const code = permutation.map((value, i) => permutation.slice(i + 1).filter(right => right < value).length);
    let factorial = 1n, answer = 1n;
    for (let i = code.length - 1; i >= 0; i--) {
        answer += BigInt(code[i]) * factorial;
        factorial *= BigInt(code.length - i);
    }
    return { code, answer: answer % 1000000007n };
}
function unpredictable(permutation: number[]) {
    for (let i = 0; i < permutation.length; i++) for (let j = i + 1; j < permutation.length; j++) {
        for (let k = j + 1; k < permutation.length; k++) {
            if (permutation[i] + permutation[k] === 2 * permutation[j]) return false;
        }
    }
    return true;
}
function firstUnpredictable(size: number) {
    const used = new Set<number>(), result: number[] = [];
    function visit(): number[] | undefined {
        if (result.length === size) return [...result];
        for (let n = 1; n <= size; n++) {
            if (used.has(n)) continue;
            result.push(n);
            if (unpredictable(result)) {
                used.add(n);
                const found = visit();
                if (found) return found;
                used.delete(n);
            }
            result.pop();
        }
        return undefined;
    }
    return visit();
}

describe('Euler 720 unchanged permutation search', () => {
    it.each([2, 3, 4, 5, 6, 8, 10])('checks the permutation rank and Lehmer code at 2^%s', bits => {
        const actual = execute(bits, true), reference = execute(bits, false), expected = rank(actual.permutation);
        expect(actual.answer).toBe(expected.answer);
        expect(actual.code).toEqual(expected.code);
        expect(actual.permutation).toEqual(reference.permutation);
        expect(actual.code).toEqual(reference.code);
        expect(actual.answer).toBe(reference.answer);
        expect(actual.diagnostics.modularCallbackScans).toBe(1);
        expect(reference.diagnostics.modularCallbackScans).toBe(0);
        if (bits <= 6) expect(unpredictable(actual.permutation)).toBe(true);
    });
    it.each([2, 3])('is the first lexicographic unpredictable permutation at 2^%s', bits => {
        expect(execute(bits, true).permutation).toEqual(firstUnpredictable(2 ** bits));
    });
    it.each([[2, 3n], [3, 2295n], [5, 641839205n]])('keeps the statement example at 2^%s', (bits, expected) => {
        expect(execute(bits as number, true).answer).toBe(expected);
    });
});
