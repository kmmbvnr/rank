import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
function execute(source: string, compilation = true, numberLoopCompilation = true) {
    const r = new Interpreter(() => {}, { compilation, numberLoopCompilation }), d = new RuntimeDiagnostics();
    try {
        const start = source.indexOf('\nfor I');
        if (start >= 0) { r.execute(source.slice(0, start)); source = source.slice(start + 1); }
        let result: string | undefined, error: string | undefined;
        try { const v = d.run(() => r.execute(source)); result = v === undefined ? undefined : formatValue(v); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, observation: { result, error, state: [...r.variables].map(([k, v]) => [k, formatValue(v)]) } };
    } finally { r.dispose(); }
}
function compare(source: string, allowError = false) {
    const a = execute(source), b = execute(source, false);
    if (!allowError) expect(b.observation.error).toBeUndefined();
    expect(a.observation).toEqual(b.observation);
    expect(a.observation).toEqual(execute(source, true, false).observation);
    return a.d;
}
const setup = `use sequences
Keys = array 4294967296 4294967301 4294967305
Keys = Keys sort
Saved = Keys
Dest = array shape 3 fill 0
Total = 0`;
const walk = (body: string, end = '3') => `${setup}
for I in 0 till ${end}
 Value = Keys I
 ${body}
end`;
describe('packed read-only inputs beside private writes', () => {
    it('borrows beside an independent nested search', () => {
        const d = compare(walk('for J in 0 till 2\n Dest I += Value mod 7 + J\nend\nTotal += Value'));
        expect(d.numberLoopBorrowedIntegerBuffers).toBeGreaterThan(0);
        expect(d.numberLoopReadBufferCells).toBe(0);
    });
    it('retries earlier private writes exactly after a late unsafe load', () => {
        const d = compare(walk('Dest I = Value\nTotal += 1').replace('4294967305', '9007199254740993'));
        expect(d.numberLoopBorrowedIntegerBuffers).toBeGreaterThan(0);
        expect(d.numberLoopOverflows).toBeGreaterThan(0);
    });
    it('does not validate an untouched unsafe tail', () => {
        const d = compare(walk('Dest I = Value\nif I equal 1\n break\nend').replace('4294967305', '9007199254740993'));
        expect(d.numberLoopBorrowedIntegerBuffers).toBeGreaterThan(0);
        expect(d.numberLoopOverflows).toBe(0);
    });
    it.each(['Dest I = Value\nTotal = 1 // (1 - I)', 'Dest I = Value'])('publishes prior writes on errors: %s', body => {
        compare(walk(body, body.includes('//') ? '3' : '4'), true);
    });
    it('retains prepared storage for repeated source reads', () => {
        const d = compare(walk('Dest I = Value + 1\nTotal += Keys I').replace('Dest = array shape 3 fill 0', 'Dest = Keys'));
        expect(d.numberLoopBorrowedIntegerBuffers).toBe(0);
    });
    it('keeps an aliased destination private', () => {
        const d = compare(walk('Dest I = Value + 1').replace('Dest = array shape 3 fill 0', 'Dest = Keys'));
        expect(d.numberLoopBorrowedIntegerBuffers).toBeGreaterThan(0);
    });
    it('rejects a source also used as a whole vector', () => {
        expect(compare(walk('Dest I = Value\nTotal += Keys sum')).numberLoopBorrowedIntegerBuffers).toBe(0);
    });
    it('does not borrow repeated nested reads', () => {
        expect(compare(`${setup}\nfor I in 0 till 3\n for J in 0 till 2\n  Value = Keys I\n  Dest I += (Value mod 7)\n end\nend`).numberLoopBorrowedIntegerBuffers).toBe(0);
    });
    it('retains rebinding rather than borrowing the previous source', () => {
        expect(compare(walk('Dest I = Value\nKeys = Keys copy')).numberLoopBorrowedIntegerBuffers).toBe(0);
    });
    it('handles reversed scalar passes', () => {
        expect(compare(walk('Dest I = Value').replace('0 till 3', '2 to 0 by -1')).numberLoopBorrowedIntegerBuffers).toBeGreaterThan(0);
    });
    it('composes a pure numeric helper with a private destination', () => {
        expect(compare(`${walk('Dest I = Value mod 7\nTotal += Dest atindex I')}\nfun Values atindex Slot\n return Values Slot\nend`).numberLoopBorrowedIntegerBuffers).toBeGreaterThan(0);
    });
    it('borrows in a whole function while reading source length metadata', () => {
        expect(compare(`${setup}
Result = Keys transform
fun Values transform
 Size = Values len
 Output = array shape Size fill 0
 for I in 0 till Size
  Value = Values I
  Output I = Value mod 7
 end
 return Output
end`).numberLoopBorrowedIntegerBuffers).toBeGreaterThan(0);
    });
    it.each(['budget', 'cancel'])('retains preparation with %s', mode => {
        const r = new Interpreter(() => {}, { scalarEntryCompilation: false }), d = new RuntimeDiagnostics();
        try {
            r.execute(setup);
            const run = () => d.run(() => r.execute('for I in 0 till 3\n Value = Keys I\n Dest I = Value\nend'));
            if (mode === 'budget') withDemandBudget(100000, run);
            else withInterrupt({ length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} }, run);
            expect(d.numberLoopBorrowedIntegerBuffers).toBe(0);
            expect(r.execute('Dest equal Keys all')).toBe(true);
        } finally { r.dispose(); }
    });
});
