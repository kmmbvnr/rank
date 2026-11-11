import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const helper = `use sequences
fun N total
 Values = 1 to N copy
 Total = 0
 for Turn in 1 to 2
  Total += Values mod (Turn + 1) sum
 end
 Next = Values * 2
 for Turn in 1 to 2
  Total += Next // (Turn + 1) sum
 end
 return Total
end`;
function run(source: string, options: InterpreterOptions = {}) {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options }), diagnostics = new RuntimeDiagnostics();
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        return { diagnostics, observation: { value: value === undefined ? undefined : formatValue(value) } };
    } catch (error) {
        return { diagnostics, observation: { error: error instanceof RankError ? error.format() : String(error) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = run(source);
    expect(result.observation).toEqual(run(source, { compilation: false }).observation);
    expect(result.observation).toEqual(run(source, { numberLoopCompilation: false }).observation);
    return result;
}
it.each([0, 1, 7, 4101])('joins two readonly vector reduction loops at size %s', n => {
    const result = compare(`${helper}\n${n} total`);
    const expected = Array.from({ length: n }, (_, i) => i + 1)
        .reduce((sum, value) => sum + value % 2 + value % 3 + value + Math.floor(2 * value / 3), 0);
    expect(result.observation.value).toBe(String(expected));
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('does not publish discarded function-local arrays after a named numeric return', () => {
    const result = compare(`${helper}\n100 total`);
    expect(result.diagnostics.typedArrayPublications).toBe(0);
});
it('binds new frames on repeated and empty calls', () => {
    expect(compare(`${helper}\narray (7 total) (0 total) (1 total)`).observation.value).toBe('55 0 3');
});
it('retains exact replay after an overflowing sum', () => {
    const source = helper.replace('1 to N copy', '1 to 7 copy').replace('Total = 0', 'Total = N');
    const result = compare(`${source}\n9007199254740990 total`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});
it.each(['Unused = 1 // 0', 'Unused = Values // 0'])('still completes an unused ordinary binding: %s', binding => {
    const source = helper.replace(' Next = Values * 2', ` ${binding}\n Next = Values * 2`);
    expect(compare(`${source}\n7 total`).observation.error).toContain('division by zero');
});
it('does not force an unused deferred error', () => {
    const source = helper.replace(' Next = Values * 2', " Unused' = Values // 0\n Next = Values * 2");
    expect(compare(`${source}\n7 total`).observation.value).toBe('55');
});
it('keeps the ordinary error attribution in the second reduction', () => {
    const source = helper.replace('Next // (Turn + 1)', 'Next // (2 - Turn)');
    expect(compare(`${source}\n7 total`).observation.error).toContain('division by zero');
});
it('returns a local array through the ordinary publication path', () => {
    const result = compare(`${helper.replace('return Total', 'return Next')}\n3 total`);
    expect(result.observation.value).toBe('2 4 6');
    expect(result.diagnostics.typedArrayPublications).toBeGreaterThan(0);
});
it('retains the existing analytic range-sum loop', () => {
    const result = compare(`fun N total
 Total = 0
 for Turn in 1 to 2
  Values = 1 to N
  Total += Values sum
 end
 return Total
end
1000000 total`);
    expect(result.observation.value).toBe('1000001000000');
    expect(result.diagnostics.numberLoops).toBe(1);
});
it('keeps packed boolean-only counts on their native path', () => {
    const result = compare(`use sequences
fun N total
 Values = array shape N fill true
 Total = 0
 for Turn in 1 to 2
  Total += Values count
 end
 return Total
end
10000 total`);
    expect(result.observation.value).toBe('20000');
    expect(result.diagnostics.numberLoops).toBe(0);
});
it('rechecks a demand budget and cancellation after warming the function', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute(`${helper}\nSaved = 5000 total`);
        expect(() => withDemandBudget(1, () => runtime.execute('Result = 5000 total'))).toThrow('demand budget exhausted');
        expect(() => withInterrupt(new Int32Array([1]), () => runtime.execute('Result = 5000 total'))).toThrow('Interrupted');
        expect(runtime.variables.has('Result')).toBe(false);
        expect(runtime.variables.get('Saved')).toBe(20843334n);
    } finally { runtime.dispose(); }
});

it.each([0, 3])('reduces real tensors with %s rows without losing their result type', n => {
    const result = compare(`use sequences
fun N total
 Values = array shape N 3 fill 0.5
 Total = 0.0
 for Turn in 1 to 2
  Total += Values sum
 end
 Next = Values * 2.0
 for Turn in 1 to 2
  Total += Next sum
 end
 return Total
end
${n} total`);
    expect(result.observation.value).toBe(String(n * 9));
});
it('preserves ordinary demand exhaustion inside an already-warm function', () => {
    for (const budget of [50, 2000, 15000]) {
        const observed: unknown[] = [];
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, compilation }), diagnostics = new RuntimeDiagnostics();
            try {
                runtime.execute(`${helper}\nSaved = 5000 total`);
                let error: string | undefined;
                try { withDemandBudget(budget, () => diagnostics.run(() => runtime.execute('Result = 5000 total'))); }
                catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
                expect(error).toContain('demand budget exhausted');
                observed.push({ error, result: runtime.variables.has('Result'), saved: runtime.variables.get('Saved') });
                if (compilation) expect(diagnostics.fallbacks['number-loop:observable-prefix-budget']).toBe(1);
            } finally { runtime.dispose(); }
        }
        expect(observed[1]).toEqual(observed[0]);
    }
});
it('polls cancellation inside a newly compiled pure region and runs caller finally', () => {
    const signal = new Int32Array(new SharedArrayBuffer(4)), diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, onIntegerLoopCompiled() { Atomics.store(signal, 0, 1); } });
    try {
        expect(() => withInterrupt(signal, () => diagnostics.run(() => runtime.execute(`${helper}
Done = 0
try
 Answer = 1000000 total
finally
 Done = 1
end`)))).toThrow('Interrupted');
        expect(runtime.variables.get('Done')).toBe(1n);
        expect(runtime.variables.has('Answer')).toBe(false);
        expect(diagnostics.numberLoops).toBe(1);
    } finally { runtime.dispose(); }
});

it('publishes only a returned owned array, not completed intermediate arrays', () => {
    const result = compare(`${helper.replace('return Total', 'return Next')}\n100 total`);
    expect(result.observation.value).toBe(Array.from({ length: 100 }, (_, i) => 2 * (i + 1)).join(' '));
    expect(result.diagnostics.numberLoops).toBe(1);
    expect(result.diagnostics.typedArrayPublications).toBe(1);
});
it('keeps returned arrays independent across private regions', () => {
    const source = helper.replace('return Total', 'return Next');
    expect(compare(`${source}
Saved = 3 total
Other = 4 total
Other 0 = 99
Saved`).observation.value).toBe('2 4 6');
});
it('still completes unused ordinary arrays before returning another array', () => {
    const source = helper.replace(' Next = Values * 2', ' Unused = Values // 0\n Next = Values * 2').replace('return Total', 'return Next');
    expect(compare(`${source}\n7 total`).observation.error).toContain('division by zero');
});
