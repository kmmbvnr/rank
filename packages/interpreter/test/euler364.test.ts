import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/364_distance.ra', import.meta.url), 'utf8');

// Count all valid orders directly, independently of the factorial formula.
function seating(n: number): bigint {
    const full = (1 << n) - 1, memo = new Map<number, bigint>();
    function count(mask: number): bigint {
        if (mask === full) return 1n;
        const known = memo.get(mask);
        if (known !== undefined) return known;
        let best = 3, choices: number[] = [];
        for (let seat = 0; seat < n; seat++) if (!(mask >> seat & 1)) {
            const occupied = (seat ? mask >> (seat - 1) & 1 : 0)
                + (seat + 1 < n ? mask >> (seat + 1) & 1 : 0);
            if (occupied < best) { best = occupied; choices = []; }
            if (occupied === best) choices.push(seat);
        }
        const result = choices.reduce((sum, seat) => sum + count(mask | 1 << seat), 0n);
        memo.set(mask, result);
        return result;
    }
    return count(0) % 100000007n;
}

function execute(n: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: ['--n', String(n)] });
    try {
        const result = runtime.execute(source);
        expect(runtime.variables.get('Answer')).toBe(result);
        return result;
    } finally { runtime.dispose(); }
}

describe.each([true, false])('Euler 364 compilation=%s', compilation => {
    it('matches direct seating orders including one-seat and parity boundaries', () => {
        for (let n = 1; n <= 12; n++) expect(execute(n, compilation)).toBe(seating(n));
    });

    it('preserves the thousand-seat example', () => {
        expect(execute(1000, compilation)).toBe(47255094n);
    });

    it('preserves the full million-seat answer', () => {
        expect(execute(1000000, compilation)).toBe(44855254n);
    }, 20_000);
});
