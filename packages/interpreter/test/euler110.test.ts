import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const demos = fileURLToPath(new URL('../../../demos/euler/', import.meta.url));
const targets = [1, 2, 3, 4, 5, 10, 20, 50, 100, 1000];

// Enumerate every integer, without the demo's ordered prime-exponent search.
// For n = product(p^e), unordered solutions number (product(2e + 1) + 1) / 2.
const expected = new Map<number, bigint>();
for (let n = 1; expected.size < targets.length; n++) {
    let rest = n, divisors = 1;
    for (let p = 2; p * p <= rest; p++) {
        let exponent = 0;
        while (rest % p === 0) { rest /= p; exponent++; }
        divisors *= 2 * exponent + 1;
    }
    if (rest > 1) divisors *= 3;
    for (const target of targets) {
        if (!expected.has(target) && (divisors + 1) / 2 > target) expected.set(target, BigInt(n));
    }
}

describe.each([false, true])('reciprocal exponent tables (compilation=%s)', compilation => {
    describe.each(['108_reciprocals', '110_reciprocals2'])('%s', name => {
        it.each(targets)('matches exhaustive integers for target %i', target => {
            const runtime = new Interpreter(() => {}, { compilation, args: [`--target=${target}`] });
            try {
                runtime.execute(readFileSync(resolve(demos, `${name}.ra`), 'utf8'));
                expect(runtime.variables.get('Answer')).toBe(expected.get(target));
            } finally { runtime.dispose(); }
        });
    });

    it.each(['108_reciprocals_test', '110_reciprocals2_test', '110_reciprocals2_default_test'])(
        'retains every assertion in %s', name => {
            const file = resolve(demos, `${name}.ra`);
            const runtime = new Interpreter(() => {}, { compilation, testing: true, sourceId: file,
                loadModule(specifier, from) {
                    const id = resolve(dirname(from ?? file), `${specifier}.ra`);
                    return { id, source: readFileSync(id, 'utf8') };
                },
            });
            try {
                runtime.execute(readFileSync(file, 'utf8'));
                expect(runtime.testResults.length).toBeGreaterThan(0);
                expect(runtime.testResults.every(test => test.passed)).toBe(true);
            } finally { runtime.dispose(); }
        },
    );
});
