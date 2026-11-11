import { describe, expect, it } from 'vitest';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';
import { isFunctionStatement } from '@arrrank/language';
import { scalarFunctionResult } from '../src/jit/scalar-function-proof.js';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, parse, type InterpreterOptions } from '../src/index.js';

function run(source: string, compilation: boolean, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    const output: string[] = [], generated: string[] = [];
    const runtime = new Interpreter(line => output.push(line), {
        scalarEntryCompilation: false, ...options, compilation,
        onFunctionBodyCompiled: source => generated.push(source),
        onBlockCompiled: source => generated.push(source),
    });
    let value: string | undefined, error: string | undefined;
    try {
        diagnostics.run(() => {
            try {
                const result = runtime.execute(source);
                if (result !== undefined) value = formatValue(result);
            } catch (cause) { error = cause instanceof RankError ? cause.format() : String(cause); }
        });
        return { observation: { value, error, output }, diagnostics, generated };
    } finally { runtime.dispose(); }
}
function compare(source: string, options: InterpreterOptions = {}) {
    const result = run(source, true, options);
    expect(result.observation).toEqual(run(source, false, options).observation);
    expect(result.observation.error).toBeUndefined();
    return result;
}

describe('bounded compiler regions', () => {
    for (const count of [255, 256, 257, 1024]) it(`keeps generated function regions for ${count} updates`, () => {
        const result = compare(`use io
fun N work
 Total = N
${' Total += 1\n'.repeat(count)} Total print
 return Total
end
3 work`);
        expect(result.observation.value).toBe(String(count + 3));
        expect(result.observation.output).toEqual([String(count + 3)]);
        expect(result.diagnostics.compilerObservations.some(entry => entry.budget?.limit === 256
            && entry.budget.alternative.includes('lazy fragments'))).toBe(true);
        expect(result.diagnostics.compiledFramedFunctions).toBeGreaterThan(0);
        expect(Math.max(...result.generated.map(source => source.length))).toBeLessThan(150000);
    });

    it('keeps generated loop regions after exceeding a whole-body proof budget', () => {
        const result = compare(`use io
Total = 0
for I in 1 to 2
${' Total += I\n'.repeat(300)} Total print
end
Total`);
        expect(result.observation.value).toBe('900');
        expect(result.observation.output).toEqual(['300', '900']);
        expect(result.diagnostics.compiledValueBlocks).toBeGreaterThan(0);
    });

    it('does not prepare or execute an unreachable suffix after a protected return', () => {
        const result = compare(`use io
fun N work
${' N += 1\n'.repeat(70)} try
  return N
 finally
  "closed" print
 end
${' "unreachable" print\n'.repeat(300)} return 0
end
3 work`);
        expect(result.observation.value).toBe('73');
        expect(result.observation.output).toEqual(['closed']);
        expect(result.diagnostics.compiledFramedFunctions).toBeGreaterThan(0);
        expect(result.generated.length).toBeLessThan(10);
    });
    it('keeps a large branch behind a checked boundary without exhausting a fragment', () => {
        const result = compare(`use io
fun N work
 Total = 0
${' Total += 1\n'.repeat(50)} if N greater 0
${'  Total += N\n'.repeat(240)} end
 Total print
 return Total
end
2 work`);
        expect(result.observation.value).toBe('530');
        expect(result.observation.output).toEqual(['530']);
        expect(result.diagnostics.compiledFramedFunctions).toBeGreaterThan(0);
    });

    it.each([15, 16, 17, 32])('keeps checked compiled calls across a chain of %s helpers', length => {
        const declarations = Array.from({ length }, (_, index) => `fun N helper${index}
 return ${index + 1 < length ? `((N + 1) helper${index + 1}) + 1` : 'N + 1'}
end`).reverse().join('\n');
        const result = compare(`${declarations}\n3 helper0`, { scalarEntryCompilation: true });
        expect(result.observation.value).toBe(String(3 + length * 2 - 1));
        expect(result.diagnostics.compilerObservations.some(entry => entry.execution?.kinds.includes('compiled'))).toBe(true);
        if (length > 16) {
            expect(result.diagnostics.compiledFramedFunctions).toBeGreaterThan(0);
            expect(result.diagnostics.compilerObservations.some(entry => entry.budget?.kind === 'scalar call graph depth')).toBe(true);
        }
    });

    it('uses a shared compiled body after exhausting argument specializations', () => {
        const calls = Array.from({ length: 40 }, (_, index) =>
            `(array shape ${Array(index + 1).fill('1').join(' ')} fill 3) measure`).join('\n');
        const result = compare(`use io
fun Values measure
 Count = Values len
 Count print
 return Count
end
${calls}
${calls}`);
        expect(result.observation.value).toBe('1');
        expect(result.observation.output).toEqual(Array(80).fill('1'));
        expect(result.diagnostics.compiledFramedFunctions).toBe(80);
        expect(result.diagnostics.compilerObservations.some(entry =>
            entry.reasons.includes('function-body:specialization-budget:32'))).toBe(true);
        expect(result.generated.length).toBeLessThan(10);
        expect(result.diagnostics.compilerObservations.some(entry => entry.budget?.kind === 'function body specializations'
            && entry.budget.alternative === 'shared framed body')).toBe(true);
    });

    it('does not regenerate evicted fragments on repeated large calls', () => {
        const result = compare(`fun N work
${' N += 1\n'.repeat(2048)} return N
end
First = 1 work
Second = 2 work
First + Second`);
        expect(result.observation.value).toBe('4099');
        expect(result.generated.length).toBeLessThan(20);
        expect(result.diagnostics.compiledFramedFunctions).toBeGreaterThan(0);
    });

    it('keeps exact wide integers and resumes calls between fragments without replay', () => {
        const result = compare(`use io
fun N report
 N print
 return N + 1
end
fun N work
${' N += 1\n'.repeat(70)} Current = N report
${' Current += 1\n'.repeat(300)} return Current
end
9007199254740990 work`);
        expect(result.observation.value).toBe('9007199254741361');
        expect(result.observation.output).toEqual(['9007199254741060']);
        expect(result.diagnostics.compiledFramedFunctions).toBeGreaterThan(0);
    });

    it('bounds private scalar proof variants without evicting an existing proof', () => {
        const program = parse('fun Values count\n return Values len\nend');
        const definition = program.statements.find(isFunctionStatement)!;
        const diagnostics = new RuntimeDiagnostics(Infinity, true);
        diagnostics.run(() => {
            const proof = (rank: number) => scalarFunctionResult(definition, true,
                [{ kind: 'array', element: 'integer', rank }], true);
            const first = proof(1);
            expect(first).toBeDefined();
            for (let rank = 2; rank <= 32; rank++) expect(proof(rank)).toBeDefined();
            for (let rank = 33; rank <= 40; rank++) expect(proof(rank)).toBeUndefined();
            expect(proof(1)).toBe(first);
        });
        expect(diagnostics.compilerObservations.some(entry => entry.budget?.kind === 'scalar proof specializations'
            && entry.budget.limit === 32)).toBe(true);
    });

    it('retains nested compiled loops after the text variant budget fills', () => {
        const calls = Array.from({ length: 16 }, (_, mask) => `count ${[0, 1, 2, 3]
            .map(bit => mask & (1 << bit) ? '"ab"' : '(array 1 2)').join(' ')} print`).join('\n');
        const result = compare(`use io
fun count First Second Third Fourth
 Total = 0
 for Pass in 1 to 1
  for FirstItem in First
   Total += 1
  end
  for SecondItem in Second
   Total += 1
  end
  for ThirdItem in Third
   Total += 1
  end
  for FourthItem in Fourth
   Total += 1
  end
 end
 return Total
end
${calls}`);
        expect(result.observation.output).toEqual(Array(16).fill('8'));
        expect(result.diagnostics.compilerObservations.some(entry =>
            entry.reasons.includes('loop:specialization-budget'))).toBe(true);
        expect(result.diagnostics.compiledLoops).toBeGreaterThan(16);
    });

    it('retains compiled body fragments when a generator exceeds its direct budget', () => {
        const result = compare(`use io
fun values
 for N in 1 to 2
${'  N += 1\n'.repeat(300)}  N print
  yield N
 end
end
values array`);
        expect(result.observation.value).toBe('301 302');
        expect(result.observation.output).toEqual(['301', '302']);
        expect(result.diagnostics.compiledValueBlocks).toBeGreaterThan(0);
    });

    it.each([false, true])('cancels a large body before later fragment effects (compiled=%s)', compilation => {
        const signal = new Int32Array(new SharedArrayBuffer(4));
        const output: string[] = [];
        const runtime = new Interpreter(line => {
            output.push(line);
            if (line === 'stop') Atomics.store(signal, 0, 1);
        }, { compilation, scalarEntryCompilation: false });
        try {
            expect(() => withInterrupt(signal, () => runtime.execute(`use io
fun N work
 "stop" print
${' N += 1\n'.repeat(1100)} "late" print
 return N
end
3 work`))).toThrow(InterruptedError);
            expect(output).toEqual(['stop']);
            Atomics.store(signal, 0, 0);
            expect(runtime.execute('2 + 3')).toBe(5n);
        } finally { runtime.dispose(); }
    });

    it('retains return contracts after switching to the shared body', () => {
        const input = (rank: number) => `(array shape ${Array(rank).fill('1').join(' ')} fill 3)`;
        const source = `Flag = false
fun Values kind
 if Flag
  return "text"
 end
 return Values len
end
${Array.from({ length: 40 }, (_, index) => `${input(index + 1)} kind`).join('\n')}
Flag = true
${input(40)} kind`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.observation.error).toBeDefined();
        expect(result.diagnostics.compilerObservations.some(entry => entry.budget?.kind === 'function body specializations')).toBe(true);
    });

    it('retains checked compiled calls when expanded call count exceeds its budget', () => {
        const declarations = Array.from({ length: 8 }, (_, index) => `fun N branch${index}
 return ${index < 7 ? `(N branch${index + 1}) + (N branch${index + 1})` : 'N + 1'}
end`).reverse().join('\n');
        const result = compare(`${declarations}\n1 branch0`, { scalarEntryCompilation: true });
        expect(result.observation.value).toBe('256');
        expect(result.diagnostics.compiledFramedFunctions).toBeGreaterThan(0);
        expect(result.diagnostics.compilerObservations.some(entry => entry.budget?.kind === 'expanded scalar calls')).toBe(true);
    });

});
