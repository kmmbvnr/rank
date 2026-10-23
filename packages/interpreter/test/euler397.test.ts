import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/397_parabola.ra', import.meta.url), 'utf8');
function brute(kMax: number, x: number): bigint {
    let count = 0;
    for (let k = 1; k <= kMax; k++) {
        for (let a = -x; a <= x; a++) for (let b = a + 1; b <= x; b++) for (let c = b + 1; c <= x; c++) {
            // Scale the three edge vectors by k. An acute 45-degree angle
            // has positive dot product equal to the absolute cross product.
            const atA = k * k + (a + b) * (a + c) === k * (c - b);
            const atB = -(k * k + (a + b) * (b + c)) === k * (c - a);
            const atC = k * k + (a + c) * (b + c) === k * (b - a);
            if (atA || atB || atC) count++;
        }
    }
    return BigInt(count);
}

function runtime(compilation: boolean, testing = false): Interpreter {
    return new Interpreter(() => {}, { compilation, testing,
        loadModule: specifier => {
            if (specifier !== '397_parabola') throw Error(`Unexpected module: ${specifier}`);
            return { id: '397_parabola.ra', source };
        },
    });
}

describe.each([false, true])('Euler 397 (compilation=%s)', compilation => {
    it('passes the published companion checks', () => {
        const r = runtime(compilation, true);
        try {
            r.execute(readFileSync(new URL('../../../demos/euler/397_parabola_test.ra', import.meta.url), 'utf8'));
            expect(r.testResults).toHaveLength(1);
            expect(r.testResults[0].passed).toBe(true);
        } finally { r.dispose(); }
    });

    it('matches direct triangle enumeration, including overlaps and empty domains', () => {
        const r = runtime(compilation);
        try {
            r.execute('use "397_parabola"');
            for (const [k, x] of [[0, 5], [1, 0], [1, 1], [1, 10], [2, 3], [3, 5], [8, 7], [10, 10], [25, 12]]) {
                r.execute(`K = ${k}\nX = ${x}\nrun`);
                expect(r.variables.get('Answer'), `K=${k}, X=${x}`).toBe(brute(k, x));
            }
        } finally { r.dispose(); }
    });

    it('preserves exact results when the coordinate bound exceeds safe integers', () => {
        const r = runtime(compilation);
        try {
            r.execute('use "397_parabola"\nK = 1\nX = 10 ** 20\nrun');
            expect(r.variables.get('Answer')).toBe(400000000000000000001n);
        } finally { r.dispose(); }
    });
});

it('keeps the complete reduced workload in one compiled region', () => {
    const r = runtime(true), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => r.execute(source.replace('option K integer = 1000000', 'option K integer = 10000')));
        expect(r.variables.get('Answer')).toBe(1008745304821002n);
        expect(diagnostics.compiledLoops).toBe(1);
        expect(diagnostics.numberLoops).toBe(1);
    } finally { r.dispose(); }
});

// Keep the reference corpus exclusion: only compiled execution is practical at
// this bound. The independent C++ oracle uses the original four-count formula.
it('finishes the default bound with exact wide accumulation', () => {
    const r = runtime(true), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => r.execute(source));
        expect(r.variables.get('Answer')).toBe(141630459461893728n);
        expect(diagnostics.compiledLoops).toBe(1);
        expect(diagnostics.mixedIntegerLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    } finally { r.dispose(); }
}, 90000);
