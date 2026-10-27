import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';

function run(source: string, options = {}) {
    const r = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    const d = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { d.run(() => r.execute(source)); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, result: { error, values: [...r.variables].map(([k, v]) => [k, formatValue(v)]) } };
    } finally { r.dispose(); }
}
function compare(source: string) {
    const actual = run(source);
    expect(actual.result).toEqual(run(source, { compilation: false }).result);
    expect(actual.result).toEqual(run(source, { numberLoopCompilation: false }).result);
    return actual.d;
}
const repeated = (limit: string, rounds = 100) => `use sequences
A = array shape 128 fill 0
Alias = A
for R in 0 till ${rounds}
 Limit = ${limit}
 J = 0
 for J less Limit
  A (J mod 128) += 1
  J += 1
 end
 Scratch = tuple J
end`;

describe('adaptive condition-loop copying', () => {
    it('learns from exact invocations without periodic copies', () => {
        const d = compare(repeated('1'));
        expect(d.numberLoopCopyProbes).toBe(1);
        expect(d.numberLoopCopyAmortized).toBe(0);
        expect(d.fallbacks['number-loop:condition-work']).toBeGreaterThan(80);
        expect(d.exactLoopWorkSamples).toBe(99);
    });
    it('keeps long invocations on the numeric backend', () => {
        const d = compare(repeated('256', 4));
        expect(d.numberLoopCopyProbes).toBe(4);
        expect(d.numberLoopCopyAmortized).toBe(4);
    });
    it('rediscovers work after a short phase', () => {
        const d = compare(repeated('(R less 40 choose 1 256)', 120));
        expect(d.numberLoopCopyAmortized).toBe(79);
        expect(d.exactLoopWorkPromotions).toBe(1);
    });
    it('learns a short phase after a long phase and recovers again', () => {
        const d = compare(repeated('((R less 5 or R at least 10) choose 256 1)', 15));
        expect(d.numberLoopCopyProbes).toBe(10);
        expect(d.numberLoopCopyAmortized).toBe(9);
        expect(d.exactLoopWorkSamples).toBe(5);
        expect(d.exactLoopWorkPromotions).toBe(1);
    });
    it('preserves preceding stores on errors during exact sampling', () => {
        const source = repeated('(R equal 0 choose 1 129)', 2).replace('A (J mod 128)', 'A J');
        expect(run(source).result.error).toContain('array index out of bounds');
        const d = compare(source);
        expect(d.numberLoopCopyProbes).toBe(1);
        expect(d.exactLoopWorkPromotions).toBe(0);
    });
    it.each(['9007199254740991', '0'])('preserves replay, aliases, and preceding stores on failure (%s)', value => {
        const d = compare(`A = array shape 128 fill 0
Alias = A
X = ${value}
J = 0
for J less 129
 A J = X + J + 1
 J += 1
end`);
        expect(d.numberLoopCopyProbes).toBeGreaterThan(0);
        expect(d.numberLoopOverflows).toBe(value === '0' ? 0 : 1);
    });
    it('retains a hard cap before copying', () => {
        const d = compare('A = array shape 262145 fill 0\nJ = 0\nfor J less 1\n A 0 = 7\n J += 1\nend');
        expect(d.numberLoopCopyProbes).toBe(0);
        expect(d.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });
    it('does not publish writes for empty loops', () => {
        const d = compare('A = array shape 128 fill 2\nAlias = A\nJ = 0\nfor J less 0\n A 0 = 7\n J += 1\nend');
        expect(d.numberLoopCopyAmortized).toBe(0);
    });
});
