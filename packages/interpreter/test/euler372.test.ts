import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Interpreter, parse} from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/372_pencils.ra', import.meta.url), 'utf8');
const program = parse(source);
const helpers = {...program, statements:program.statements.filter(s =>
    s.$type === 'UseStatement' || s.$type === 'FunctionStatement')};

function sqrt(n: bigint): bigint {
    let low = 0n, high = n + 1n;
    while (low + 1n < high) {
        const mid = (low + high) / 2n;
        if (mid * mid <= n) low = mid;
        else high = mid;
    }
    return low;
}

describe.each([{}, {numberLoopCompilation:false}, {compilation:false}])('Euler 372 %o', options => {
    it('matches direct lattice enumeration around square boundaries', () => {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.executeProgram(helpers, []);
            for (let high = 1; high <= 40; high++) for (const low of [0, Math.floor(high / 3), high - 1]) {
                let expected = 0n;
                for (let x = low + 1; x <= high; x++) for (let y = low + 1; y <= high; y++) {
                    if (Math.floor(y * y / (x * x)) % 2) expected++;
                }
                expect(runtime.execute(`${low} pencils ${high}`)).toBe(expected);
            }
            expect(runtime.execute('0 pencils 100')).toBe(3019n);
            expect(runtime.execute('100 pencils 1000')).toBe(254713n);
        } finally {runtime.dispose();}
    });

    it('keeps irrational sums exact beyond the Number range', () => {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.executeProgram(helpers, []);
            for (let k = 2n; k <= 50n; k++) {
                const r = sqrt(k);
                if (r * r === k) continue;
                let sum = 0n;
                for (let n = 0n; n <= 32n; n++) {
                    sum += sqrt(k * n * n);
                    expect(runtime.execute(`${k} ${r} ${n} surdsum`)).toBe(sum);
                }
            }
            for (const k of [2n, 3n, 99n, 249999n]) for (const n of [999999999n, 9007199254740993n, 10n ** 30n]) {
                const a = runtime.execute(`${k} ${sqrt(k)} ${n} surdsum`) as bigint;
                const b = runtime.execute(`${k} ${sqrt(k)} ${n - 1n} surdsum`) as bigint;
                expect(a - b).toBe(sqrt(k * n * n));
            }
        } finally {runtime.dispose();}
    });
});

it('retains the full exact answer and compiles the helper chain', () => {
    let calls = 0;
    const runtime = new Interpreter(() => {}, {onScalarFunctionExecuted:() => calls++});
    try {
        runtime.execute(source);
        expect(runtime.variables.get('Answer')).toBe(301450082318807027n);
        expect(calls).toBeGreaterThan(0);
    } finally {runtime.dispose();}
});
