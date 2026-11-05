import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/719_numbersplitting.ra', import.meta.url), 'utf8');

// Enumerate decimal cut positions directly, independently of the frontier search.
function oracle(limit: number) {
    let total = 0n;
    for (let root = 2; root * root <= limit; root++) {
        const digits = String(root * root);
        function split(start: number, sum: number, count: number): boolean {
            if (start === digits.length) return count >= 2 && sum === root;
            let block = 0;
            for (let end = start; end < digits.length; end++) {
                block = block * 10 + Number(digits[end]);
                if (sum + block > root) break;
                if (split(end + 1, sum + block, count + 1)) return true;
            }
            return false;
        }
        if (split(0, 0, 0)) total += BigInt(root * root);
    }
    return total;
}
function run(limit: number, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source.replace('arg Limit integer = 10 ** 12', `Limit = ${limit}`)));
        return { answer: runtime.variables.get('Answer'), diagnostics };
    } finally { runtime.dispose(); }
}

describe('Euler 719 decimal partitions', () => {
    it.each([1, 4, 9, 80, 81, 99, 100, 9999, 10000, 10001, 1000000])(
        'matches independent cut enumeration at %s', limit => {
            const expected = oracle(limit);
            expect(run(limit).answer).toBe(expected);
            expect(run(limit, false).answer).toBe(expected);
        });
    it('compiles deferred tensors for the published statement example', () => {
        const result = run(10000);
        expect(result.answer).toBe(41333n);
        expect(result.diagnostics.numberTensors).toBeGreaterThan(0);
        expect(result.diagnostics.rankedArrayBatches).toBe(0);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });


});
