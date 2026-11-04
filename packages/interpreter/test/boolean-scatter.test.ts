import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, RankError } from '../src/index.js';
import { withInterrupt, type InterruptSignal } from '../src/interrupt.js';

function execute(source: string, compilation = true, numberLoopCompilation = true, observed = false) {
    const r = new Interpreter(() => {}, { compilation, numberLoopCompilation, scalarEntryCompilation: false });
    const d = new RuntimeDiagnostics(), words = [0, 0, 0];
    const signal: InterruptSignal = { length: 3, load: i => words[i], store: (i, v) => { words[i] = v; },
        exchange(i, v) { const old = words[i]; words[i] = v; return old; }, wait() { throw Error('unexpected pause'); } };
    try {
        let result: string | undefined, error: string | undefined, resultType: string | undefined;
        const run = () => { const value = r.execute(source); result = value === undefined ? undefined : formatValue(value); resultType = typeof value; };
        try { d.run(() => observed ? withInterrupt(signal, run, () => {}) : run()); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, observation: { result, resultType, error, state: [...r.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { r.dispose(); }
}
function compare(source: string, observed = false) {
    const actual = execute(source, true, true, observed);
    expect(actual.observation).toEqual(execute(source, false, false, observed).observation);
    expect(actual.observation).toEqual(execute(source, true, false, observed).observation);
    return actual;
}
const head = 'use sequences\nA = array false true false true\nSaved = A\nIx = array 2 0 2\nDone = 0\n';

describe('boolean scatter and numeric mask selections', () => {
    it.each(['true', 'false', 'A Ix'])('snapshots boolean RHS %s with duplicate selectors', rhs => {
        const r = compare(head + `for I in 1 to 3\n A Ix = ${rhs}\n Done = I\nend\ntuple A Saved`);
        expect(r.observation.error).toBeUndefined();
        expect(r.d.numberLoops).toBe(rhs === 'A Ix' ? 0 : 1);
    });
    it.each([false, true])('compiles mask selection and bool stores with observation %s', observed => {
        const r = compare(`A = array shape 25 fill false
Saved = A
Values = array 2 4 6 8
Done = 0
B = Values
for I in 1 to 3
 B = Values (Values at most I * 2)
 A (I + B) = true
 Done = I
end
tuple A Saved B`, observed);
        expect(r.observation.error).toBeUndefined();
        if (!observed) {
            expect(r.d.compiledLoops).toBeGreaterThan(0);
            expect(r.d.numberLoops).toBe(1);
        }
    });
    it.each(['array shape 0 fill 0', 'array shape 1 2 fill 1'])('preserves selector shape %s', ix => {
        const r = compare(head.replace('Ix = array 2 0 2', `Ix = ${ix}`) + `for I in 1 to 3\n A Ix = true\n Done = I\nend\nA`);
        expect(r.observation.error).toBeUndefined();
        expect(r.d.numberLoops).toBe(1);
    });
    it.each(['A (Ix + I) = true', 'A Ix = array true false', 'A Ix = 1',
        'A (Ix + 9007199254740991) = true'])('preserves earlier state and error: %s', statement => {
        const r = compare(head + `for I in 1 to 3\n ${statement}\n Done = I\nend\nA`);
        expect(r.observation.error).toBeDefined();
    });
    it.each(['array true', 'array true false', 'array shape 2 2 fill true'])('retains mask shape errors for %s', mask => {
        const r = compare(`A = array 1 2 3\nMask = ${mask}\nB = A\nDone = 0\nfor I in 1 to 3\n B = A Mask\n Done = I\nend\nB`);
        expect(r.observation.error).toBeDefined();
    });
    it('keeps real mask filtering in Number mode', () => {
        const r = compare(`A = array -1.5 2.5 3.0\nB = A\nDone = 0\nfor I in 1 to 3\n B = A (A greater I)\n Done = I\nend\nB`);
        expect(r.observation.error).toBeUndefined();
        expect(r.d.numberLoops).toBe(1);
    });
    it.each([
        ['array 1 2 3', '7', 'bigint'],
        ['array 1.5 2.5 3.5', '7.0', 'number'],
        ['array 1.5 2.5 3.5', '-0.0', 'number'],
    ])('returns scalar RHS %s / %s with its original type', (values, rhs, type) => {
        const r = compare(`A = ${values}\nIx = array 2 0\nfor I in 1 to 3\n A Ix = ${rhs}\nend`);
        expect(r.observation.error).toBeUndefined();
        expect(r.observation.resultType).toBe(type);
        expect(r.d.numberLoops).toBe(1);
    });
    it.each(['2 // Ix', '3 - Ix', 'Ix * 9007199254740991'])('replays a streamed selector failure before any store: %s', keys => {
        const r = compare(`A = array shape 4 fill false\nIx = array 1 2 0\nSaved = A\nDone = 0\nfor I in 1 to 3\n A (${keys}) = true\n Done = I\nend`);
        if (keys !== '3 - Ix') {
            expect(r.observation.error).toBeDefined();
            expect(r.d.numberLoopOverflows).toBeGreaterThan(0);
        }
    });
    it('retains an escaping live array RHS on the publishing backend', () => {
        const r = compare(head + 'for I in 1 to 3\n A Ix = A Ix\nend');
        expect(r.observation.error).toBeUndefined();
        expect(r.d.numberLoops).toBe(0);
    });
    it('returns an escaping scalar RHS without forcing a selection', () => {
        const r = compare(head + 'for I in 1 to 3\n A Ix = true\nend');
        expect(r.observation.error).toBeUndefined();
        expect(r.observation.result).toBe('true');
        expect(r.d.numberLoops).toBe(1);
        expect(r.d.compiledLoops).toBe(1);
    });
});
