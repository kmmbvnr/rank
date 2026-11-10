import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, RankError } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

function run(body: string, compilation: boolean, mode = 'ordinary') {
    const r = new Interpreter(() => {}, { compilation }), d = new RuntimeDiagnostics();
    try {
        const execute = () => d.run(() => r.execute(body));
        let value: string | undefined, error: string | undefined;
        try {
            const result = mode === 'budget' ? withDemandBudget(1000000, execute)
                : mode === 'interrupt' ? withInterrupt(new Int32Array(1), execute)
                : mode === 'inspection' ? withInterrupt(new Int32Array(1), execute, () => {}) : execute();
            value = result === undefined ? undefined : formatValue(result);
        } catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { observation: { value, error }, d };
    } finally { r.dispose(); }
}
const program = (declaration = "Mask' = Values greater I", consumer = 'Selected = Mask indices', before = '', after = '') => `use numbers
use sequences
fun Size solve
 Total = 0
 for I in 1 to 3
  Values = 0 till Size copy
  ${before}
  ${declaration}
  ${consumer}
  Total += Selected sum
  ${after}
 end
 return Total
end
12 solve`;

it('compiles an iteration-private deferred mask at its eager indices consumer', () => {
    const source = program(), reference = run(source, false), compiled = run(source, true);
    expect(compiled.observation).toEqual(reference.observation);
    expect(compiled.observation.error).toBeUndefined();
    expect(compiled.d.numberLoops).toBeGreaterThan(0);
});
it('does not compute an unused erroneous recipe', () => {
    const source = program("Unused' = Values // 0", 'Selected = Values copy');
    const reference = run(source, false), compiled = run(source, true);
    expect(compiled.observation).toEqual(reference.observation);
    expect(compiled.observation.error).toBeUndefined();
    expect(compiled.d.numberLoops).toBeGreaterThan(0);
});
it('replays a demanded arithmetic error at its ordinary location', () => {
    const source = program("Mask' = Values // 0 greater 0");
    const reference = run(source, false), compiled = run(source, true);
    expect(compiled.observation).toEqual(reference.observation);
    expect(compiled.observation.error).toMatch(/division by zero/);
});
it('retains the plan capture when a dependency is rebound before demand', () => {
    const source = program("Mask' = Values greater I", 'Values = Values + 100\n  Selected = Mask indices');
    const reference = run(source, false), compiled = run(source, true);
    expect(compiled.observation).toEqual(reference.observation);
    expect(compiled.observation.error).toBeUndefined();
});
it('does not inline an escaping plan into a returned eager value', () => {
    const source = `use numbers
use sequences
fun Size recipe
 Values = 0 till Size copy
 Mask' = Values greater 2
 return Mask
end
Saved' = 12 recipe
Saved indices`;
    expect(run(source, true).observation).toEqual(run(source, false).observation);
});
it('retains ordinary public deferred bindings after a loop', () => {
    const source = `use numbers
use sequences
for I in 1 to 3
 Values = 0 till 12 copy
 Mask' = Values greater I
 Selected = Mask indices
end
Mask indices`;
    expect(run(source, true).observation).toEqual(run(source, false).observation);
});
it.each(['budget', 'interrupt', 'inspection'])('retains observable execution with %s', mode => {
    const compiled = run(program(), true, mode);
    expect(compiled.observation).toEqual(run(program(), false, mode).observation);
    if (mode !== 'interrupt') expect(compiled.d.numberLoops).toBe(0);
});
it('does not erase a constructor error for an unknown captured name', () => {
    const source = program("Unused' = Missing + 1", 'Selected = Values copy');
    expect(run(source, true).observation).toEqual(run(source, false).observation);
    expect(run(source, true).observation.error).toMatch(/unknown name/);
});
it('retains array capture protection even after the last eager consumer', () => {
    const source = program(undefined, undefined, '', 'Values 0 = 99');
    expect(run(source, true).observation).toEqual(run(source, false).observation);
});
it('handles repeated eager consumers without memoizing the recipe', () => {
    const source = program(undefined, 'Selected = Mask indices\n  Again = Mask indices');
    const compiled = run(source, true);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.d.numberLoops).toBeGreaterThan(0);
});
it('retains rebinding through unpacking instead of treating it as a stage', () => {
    const source = program(undefined, 'unpack Mask More = tuple (Values greater 0) (Values greater 0)\n  Selected = Mask indices');
    const reference = run(source, false);
    expect(reference.observation.error).toBeUndefined();
    expect(run(source, true).observation).toEqual(reference.observation);
});
it.each(['copy', 'sum'])('compiles a private arithmetic recipe at %s', consumer => {
    const original = program("Mask' = Values + I", `Selected = Mask ${consumer}`);
    const source = consumer === 'sum' ? original.replace('Total += Selected sum', 'Total += Selected') : original;
    const compiled = run(source, true), reference = run(source, false);
    expect(compiled.observation).toEqual(reference.observation);
    expect(compiled.observation.error).toBeUndefined();
    expect(compiled.d.numberLoops).toBeGreaterThan(0);
});
it('retains empty array recipes', () => {
    const source = program().replace('12 solve', '0 solve');
    const compiled = run(source, true);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.observation.error).toBeUndefined();
});

it('reuses the proof with new invocation values and vector sizes', () => {
    const source = program().replace('12 solve', 'First = 12 solve\nSecond = 5 solve\ntuple First Second');
    const compiled = run(source, true);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.observation.error).toBeUndefined();
    expect(compiled.d.numberLoops).toBeGreaterThan(1);
});
it('retains exact arithmetic when a private recipe exceeds Number precision', () => {
    const source = program("Mask' = Values * 9007199254740993 greater 0");
    expect(run(source, true).observation).toEqual(run(source, false).observation);
});
it('retains capture protection for an unused array recipe', () => {
    const source = program("Unused' = Values + 1", 'Selected = Values copy', '', 'Values 0 = 99');
    expect(run(source, true).observation).toEqual(run(source, false).observation);
});
it('retains compound writes to a captured array after consumption', () => {
    const source = program(undefined, undefined, '', 'Values += 100');
    expect(run(source, true).observation).toEqual(run(source, false).observation);
});

it('captures scalar parameters without demanding their recipe early', () => {
    const source = program().replace('fun Size solve', 'fun Size solve Threshold')
        .replace('Values greater I', 'Values greater Threshold').replace('12 solve', '12 solve 3');
    const compiled = run(source, true);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.observation.error).toBeUndefined();
    expect(compiled.d.numberLoops).toBeGreaterThan(0);
});

it('counts unused deferred stages toward the complete numeric proof budget', () => {
    const text = `use numbers
use sequences
fun Size solve
 Values = 0 till Size copy
${Array.from({ length: 130 }, (_, i) => ` Unused${i}' = Values // 0`).join('\n')}
 Total = Values sum
 return Total
end
12 solve`;
    const compiled = run(text, true), reference = run(text, false);
    expect(compiled.observation).toEqual(reference.observation);
    expect(compiled.observation.error).toBeUndefined();
    expect(compiled.d.numberLoops).toBe(0);
});
