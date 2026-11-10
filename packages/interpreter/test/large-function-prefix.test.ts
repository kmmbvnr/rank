import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

// More than the generic block dispatcher's 64 statements, while remaining
// within the numeric region's independent proof budget.
const helper = `use numbers
use sequences
fun Seed compute Width
 Values = 0 till Width copy
 Values = Values + Seed
${Array.from({ length: 64 }, () => ' Values = Values + 1').join('\n')}
 Total = Values sum
 return Total
end
`;
function run(text: string, compilation: boolean, mode = 'ordinary') {
    const runtime = new Interpreter(() => {}, { compilation }), diagnostics = new RuntimeDiagnostics();
    let value: string | undefined, error: string | undefined;
    try {
        const execute = () => diagnostics.run(() => runtime.execute(text));
        try {
            const result = mode === 'budget' ? withDemandBudget(1000000, execute)
                : mode === 'inspection' ? withInterrupt(new Int32Array(1), execute, () => {})
                : mode === 'interrupt' ? withInterrupt(new Int32Array(1), execute) : execute();
            value = result === undefined ? undefined : formatValue(result);
        } catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { observation: { value, error }, diagnostics };
    } finally { runtime.dispose(); }
}
it('compiles a numeric helper independently of the generic block limit', () => {
    const text = helper + '1 compute 4', compiled = run(text, true);
    expect(compiled.observation).toEqual(run(text, false).observation);
    expect(compiled.observation.error).toBeUndefined();
    expect(compiled.diagnostics.numberLoops).toBeGreaterThan(0);
});
it.each(['budget', 'inspection', 'interrupt'])('preserves %s execution for large helpers', mode => {
    const text = helper + '1 compute 4', compiled = run(text, true, mode);
    expect(compiled.observation).toEqual(run(text, false, mode).observation);
    expect(compiled.observation.error).toBeUndefined();
    if (mode !== 'interrupt') expect(compiled.diagnostics.numberLoops).toBe(0);
});
it.each(['9007199254740993', '9007199254740960', '0.5'])('retains exact/fallback execution at seed %s', seed => {
    const text = helper + `First = 1 compute 4\nSecond = ${seed} compute 4\nThird = 2 compute 0\ntuple First Second Third`;
    const compiled = run(text, true);
    expect(compiled.observation).toEqual(run(text, false).observation);
    if (seed === '0.5') expect(compiled.observation.error).toMatch(/cannot receive/);
    else expect(compiled.observation.error).toBeUndefined();
});
it('replays errors with their ordinary source location after a failed region', () => {
    const text = helper.replace(' Total = Values sum', ' Values = Values // 0\n Total = Values sum') + '1 compute 4';
    const compiled = run(text, true);
    expect(compiled.observation).toEqual(run(text, false).observation);
    expect(compiled.observation.error).toMatch(/division by zero/);
});
