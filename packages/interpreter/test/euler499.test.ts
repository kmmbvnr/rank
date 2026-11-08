import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, formatValue, type InterpreterOptions } from '../src/index.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget } from '../src/interrupt.js';

const fixture = new URL('../../../demos/euler/499_stpetersburg_test.ra', import.meta.url);
const source = readFileSync(new URL('499_stpetersburg.ra', fixture), 'utf8');
const setup = source.replace('arg T integer = 15', 'arg T integer = 1').replace('arg B integer = 1000000000', 'arg B integer = 1');
const oracle: { ticket: number; capital: number; lower: string; upper: string; roundedLow: string; roundedHigh: string }[] = JSON.parse(readFileSync(new URL('../../../benchmarks/fixtures/euler499-bounds.json', import.meta.url), 'utf8'));
const modes: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];

it.each(modes)('certifies Decimal reference results and keeps uncertain cases on the matrix solver with %j', options => {
    const r = new Interpreter(() => {}, options);
    let calls = 0;
    try {
        r.execute(setup);
        r.variables.set('matrix_chance', native('matrix_chance', 2, () => { calls++; return -123.0; }));
        for (const row of oracle) {
            calls = 0;
            const actual = r.execute(`${row.ticket} chance ${row.capital}`);
            if (row.roundedLow === row.roundedHigh) {
                expect(actual).toBe(Number(row.roundedLow));
                expect(calls).toBe(0);
            } else {
                expect(actual).toBe(-123.0);
                expect(calls).toBe(1);
            }
        }
        expect(r.execute('1 chance 0')).toBe(0.0);
        expect(r.execute('1 chance 1')).toBe(1.0);
        expect(r.execute('15 chance 14')).toBe(0.0);
        expect(() => withDemandBudget(1, () => r.execute('15 chance 1000000000'))).toThrow('demand budget exhausted');
    } finally { r.dispose(); }
});

it.each(modes)('encloses independent 90-digit survival bounds with %j', options => {
    const r = new Interpreter(() => {}, options);
    try {
        r.execute(setup.split('\nAnswer =')[0].replace('  Rounded = Bounds round 7', '  return Bounds\n  Rounded = Bounds round 7'));
        for (const row of oracle) {
            const bounds = formatValue(r.execute(`${row.ticket} chance ${row.capital}`)!).split(' ').map(Number);
            expect(bounds[0], `${row.ticket}/${row.capital} lower`).toBeLessThanOrEqual(Number(row.lower));
            expect(bounds[1], `${row.ticket}/${row.capital} upper`).toBeGreaterThanOrEqual(Number(row.upper));
        }
    } finally { r.dispose(); }
});

it.each(modes)('retains the statement fixture and matrix fallback with %j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule: () => ({ id: new URL('499_stpetersburg.ra', fixture).pathname, source }),
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true]); }
    finally { r.dispose(); }
}, 30_000);
