import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/343_fractional.ra', import.meta.url), 'utf8');
function createRuntime(compilation: boolean, testing = false): Interpreter {
    return new Interpreter(() => {}, {
        compilation, testing,
        loadModule: specifier => {
            if (specifier !== '343_fractional') throw Error(`Unexpected module: ${specifier}`);
            return { id: '343_fractional.ra', source };
        },
    });
}

function largestFactor(value: number): bigint {
    let largest = 1;
    for (let divisor = 2; divisor * divisor <= value; divisor++) {
        while (value % divisor === 0) { largest = divisor; value /= divisor; }
    }
    return BigInt(value > 1 ? value : largest);
}

describe.each([false, true])('Euler 343 bulk factorization (compilation=%s)', compilation => {
    it('passes the companion Rank tests', () => {
        const runtime = createRuntime(compilation, true);
        try {
            runtime.execute(readFileSync(new URL('../../../demos/euler/343_fractional_test.ra', import.meta.url), 'utf8'));
            expect(runtime.testResults).toHaveLength(3);
            expect(runtime.testResults.every(test => test.passed)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('matches every quadratic largest factor against independent trial division', () => {
        const runtime = createRuntime(compilation);
        try {
            runtime.execute('use "343_fractional" as fractional');
            // Check every short prefix, including the double root modulo 3,
            // repeated prime powers and the second root of a discovered prime,
            // then the longer ranges that exercise the factor table.
            let expected = 0n;
            for (let limit = 1; limit <= 1000; limit++) {
                const a = largestFactor(limit + 1), b = largestFactor(limit * limit - limit + 1);
                expected += (a > b ? a : b) - 1n;
                if (limit <= 100 || limit % 100 === 0) {
                    expect(runtime.execute(`fractional ${limit}`), `limit=${limit}`).toBe(expected);
                }
            }
        } finally { runtime.dispose(); }
    });

    it('preserves reduced checksums', () => {
        const runtime = createRuntime(compilation);
        try {
            runtime.execute(source.replace('arg Limit integer = 2000000', 'arg Limit integer = 1000'));
            expect(runtime.variables.get('Answer')).toBe(72421603n);
        } finally { runtime.dispose(); }
    });
});

it('preserves the full Euler 343 checksum with compiled slice writes', () => {
    const runtime = createRuntime(true);
    try {
        runtime.execute(source);
        expect(runtime.variables.get('Answer')).toBe(269533451410884183n);
    } finally { runtime.dispose(); }
}, 15_000);
