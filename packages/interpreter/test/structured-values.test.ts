import { withInterrupt, InterruptedError } from '../src/interrupt.js';
import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, type RankRecord, type InterpreterOptions } from '../src/index.js';

function execute(source: string, compilation: boolean, options: InterpreterOptions = {}) {
    const output: string[] = [];
    const diagnostics = new RuntimeDiagnostics(Infinity, true);
    const runtime = new Interpreter(line => output.push(String(line)), { ...options, compilation });
    let result: string | undefined, error: string | undefined;
    try {
        diagnostics.run(() => {
            try { const value = runtime.execute(source); result = value === undefined ? undefined : formatValue(value); }
            catch (cause) { if (!(cause instanceof RankError)) throw cause; error = cause.format(); }
        });
        return { result, error, output, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string, backend?: string, options?: InterpreterOptions) {
    const reference = execute(source, false, options), compiled = execute(source, true, options);
    const observable = ({ result, error, output }: ReturnType<typeof execute>) => ({ result, error, output });
    expect(observable(compiled)).toEqual(observable(reference));
    if (backend) expect(compiled.diagnostics.compilerObservations.some(entry => entry.backend === backend
        && entry.phase === 'execute' && entry.outcome === 'selected'), JSON.stringify({ error: compiled.error, paths: compiled.diagnostics.compilerObservations.filter(entry => entry.phase === 'execute').map(entry => entry.backend) })).toBe(true);
    return compiled;
}

const record = 'record\n .count = 3\n .name = "Ada"\nend';

describe('structured values through compiled boundaries', () => {
    it('constructs records and tuples with the runtime structural contracts', () => {
        const result = compare(`State = ${record}\nPair = tuple State -2 true\nPair`, 'value-expression');
        expect(result.error).toBeUndefined();
    });
    it('reads fields, updates a copy and preserves the source record', () => {
        const result = compare(`State = ${record}\nNext = State with\n .count += 4\nend\ntuple (State .count) (Next .count)`, 'value-expression');
        expect(result.result).toBe('3 7');
    });
    it('keeps enclosing compilation for record parameters, updates and returns', () => {
        const result = compare(`fun State changed
 Next = State with
  .count += 4
 end
 return Next
end
State = ${record}
Next = State changed
tuple (State .count) (Next .count)`, 'framed-function');
        expect(result.result).toBe('3 7');
    });
    it('reads and writes nested fields through shared record aliases', () => {
        const result = compare(`fun State increment
 Child = State .child
 Child .count += 2
 return State .child .count
end
State = record
 .child = ${record}
end
Alias = State
Value = State increment
tuple Value (Alias .child .count)`, 'framed-function');
        expect(result.result).toBe('5 5');
    });
    it('unpacks mixed structured helper results once', () => {
        const result = compare(`use io
fun N produce
 N print
 State = record
  .count = N
 end
 return tuple State "ok" true
end
fun N consume
 unpack State Name Flag = N produce
 return tuple (State .count) Name Flag
end
3 consume`, 'framed-function');
        expect(result.result).toBe('3 ok true');
        expect(result.output).toEqual(['3']);
    });
    for (const kind of ['queue', 'stack', 'deque']) for (const item of ['1.5', 'true', '"hello"', record, 'array 1 2']) {
        it(`carries ${kind} elements ${item.split('\n')[0]} through helpers`, () => {
            const result = compare(`use algo
fun Store takeitem
 return Store pop
end
fun Store append Value
 Store push Value
 return Store
end
Store = new ${kind}
Value = ${item}
Alias = Store append Value
Actual = Alias takeitem
Actual`, 'framed-function');
            expect(result.error).toBeUndefined();
        });
    }
    for (const item of ['1.5', 'true', '"hello"', record, 'array 1 2']) {
        it(`supports set values ${item.split('\n')[0]} through a compiled body`, () => {
            const result = compare(`use algo
fun Store includeitem Value
 Store add Value
 return Store
end
Store = new set
Value = ${item}
Alias = Store includeitem Value
Alias len`, 'framed-function');
            expect(result.result).toBe('1');
        });
    }
    it('keeps heterogeneous index values and text keys', () => {
        const result = compare(`use algo
fun Store populate
 Store "count" = 3
 Store "name" = "Ada"
 Store "active" = true
 return Store
end
Store = new index
Alias = Store populate
tuple (Alias "count") (Alias "name") (Alias "active")`, 'framed-function');
        expect(result.result).toBe('3 Ada true');
    });
    it('keeps array snapshots across record and container boundaries', () => {
        const result = compare(`use algo
use sequences
fun Values pack
 State = record
  .items = Values
 end
 Store = new queue
 Store push State
 return Store
end
Values = array 1 2
Store = Values pack
Values 0 = 9
State = Store pop
State .items`, 'framed-function');
        expect(result.result).toBe('1 2');
    });
    for (const invalid of [
        'State .count = "bad"', 'State .missing = 1', 'State = State with\n .count = "bad"\nend',
        'unpack A B = tuple 1 2 3', 'State = record\n .count = "bad"\n .name = "Ada"\nend',
    ]) it(`retains errors: ${invalid.split('\n')[0]}`, () => {
        expect(compare(`State = ${record}\n${invalid}`).error).toBeDefined();
    });
    it('does not evaluate a duplicate field RHS', () => {
        expect(compare('State = record\n .count = 1\n .count = 1 // 0\nend').error).toContain('duplicate record field');
    });
    it('preserves input effects and errors inside a record constructor', () => {
        const result = compare(`use io
fun N item
 N print
 return 10 // N
end
State = record
 .first = 2 item
 .second = 0 item
 .third = 3 item
end`);
        expect(result.error).toBeDefined();
        expect(result.output).toEqual(['2', '0']);
    });
    it('retains element-type errors in general container calls', () => {
        const result = compare(`use algo
fun Store append Value
 Store push Value
 return Store
end
Store = new queue
Before = Store append "hello"
After = Store append 1`, 'framed-function');
        expect(result.error).toContain('cannot receive integer');
    });
    it('maps ranked record results and passes them through another helper', () => {
        const result = compare(`use sequences
fun N entry rank 0
 return record
  .count = N
  .active = true
 end
end
fun Rows passthrough
 Result = Rows
 return Result
end
fun State countitem rank 0
 return State .count
end
Rows = (array 1 2 3) entry
Rows = Rows passthrough
Rows countitem`, 'framed-function');
        expect(result.error).toBeUndefined();
        expect(result.result).toBe('1 2 3');
    });
    it('keeps integer groups as an intentional language contract', () => {
        const result = compare(`use algo
fun Store append Value
 Store 0 Value insert
 return Store
end
Store = 1 groups
Good = Store append 3
Bad = Store append "text"`);
        expect(result.error).toBeDefined();
    });
    it('does not change return contracts when generic code is reused', () => {
        const result = compare(`fun N result
 if N equal 0
  return record
   .count = 1
  end
 end
 return record
  .count = "bad"
 end
end
First = 0 result
Second = 1 result`, 'framed-function');
        expect(result.error).toContain('ReturnTypeMismatch');
    });
    it('keeps generated record code independent of input schemas', () => {
        let prepared = 0;
        const runtime = new Interpreter(() => {}, { onFunctionBodyCompiled: () => prepared++ });
        try {
            runtime.execute('fun State passthrough\n Result = State\n return Result\nend');
            for (let index = 0; index < 40; index++) {
                const value = runtime.execute(`(record\n .field${index} = ${index}\nend) passthrough`);
                expect(formatValue(value!)).toContain(String(index));
            }
            expect(prepared).toBe(1);
        } finally { runtime.dispose(); }
    });
    it('compiles loop bodies containing structured writes and early exits', () => {
        const result = compare(`State = record
 .count = 0
end
for I in 1 to 5
 State .count += I
 if I equal 3
  break
 end
end
State .count`, 'value-block');
        expect(result.result).toBe('6');
    });
    it('resumes calls in a structured loop body without replaying writes', () => {
        const result = compare(`use io
fun N logged
 N print
 return tuple N "ok"
end
Total = 0
for I in 1 to 3
 unpack Count Name = I logged
 Total += Count
end
Total`, 'value-block');
        expect(result.result).toBe('6');
        expect(result.output).toEqual(['1', '2', '3']);
    });
    it('preserves generator suspension in structured loop bodies', () => {
        const result = compare(`use sequences
fun pairs
 for I in 1 to 3
  yield tuple I "ok"
 end
end
Values = pairs array
unpack Count Name = Values 1
Count`, 'value-block', { generatorLoopCompilation: false });
        expect(result.error).toBeUndefined();
        expect(result.result).toBe('2');
    });
    it('runs finally once after returning a record from a loop', () => {
        const result = compare(`use io
fun N work
 State = record
  .count = 0
 end
 try
  for I in 1 to N
   State .count += I
   if I equal 2
    return State
   end
  end
 finally
  "finished" print
 end
 return State
end
State = 3 work
State .count`, 'value-block');
        expect(result.result).toBe('3');
        expect(result.output).toEqual(['finished']);
    });
    it('falls back when dynamic JavaScript is blocked', () => {
        const blocked = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try {
            const result = compare(`State = ${record}\nState .count`);
            expect(result.result).toBe('3');
            expect(result.diagnostics.compilerObservations.some(entry =>
                entry.reasons.includes('value-expression:dynamic-code-unavailable'))).toBe(true);
        } finally { blocked.mockRestore(); }
    });
    it('does not inspect host record accessors during preparation or tracing', () => {
        const calls: number[] = [];
        for (const compilation of [false, true]) {
            let reads = 0;
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                const state = runtime.execute(`State = ${record}\nState`) as RankRecord;
                const original = state.entries.get.bind(state.entries);
                state.entries.get = name => { reads++; return original(name); };
                const diagnostics = new RuntimeDiagnostics(Infinity, true);
                expect(diagnostics.run(() => runtime.execute('State .count'))).toBe(3n);
                calls.push(reads);
            } finally { runtime.dispose(); }
        }
        expect(calls[1]).toBe(calls[0]);
    });
    it.each([false, true])('cancels a structured loop after committed effects (compiled=%s)', compilation => {
        const signal = new Int32Array(new SharedArrayBuffer(4)), output: string[] = [];
        const runtime = new Interpreter(line => {
            output.push(String(line));
            if (output.length === 2) Atomics.store(signal, 0, 1);
        }, { compilation });
        try {
            expect(() => withInterrupt(signal, () => runtime.execute(`use io
State = record
 .count = 0
end
for I in 1 to 10
 State .count += I
 I print
end`))).toThrow(InterruptedError);
            expect(output).toEqual(['1', '2']);
            Atomics.store(signal, 0, 0);
            expect(runtime.execute('State .count')).toBe(3n);
            expect(runtime.execute('2 + 3')).toBe(5n);
        } finally { runtime.dispose(); }
    });
    it('honors the scalar expression capability switch', () => {
        const result = compare(`State = ${record}\nState .count`, undefined, { scalarCompilation: false });
        expect(result.result).toBe('3');
        expect(result.diagnostics.compilerObservations.some(entry => entry.backend === 'value-expression')).toBe(false);
    });
    it('bounds constructor code size', () => {
        const result = compare(`State = record\n${Array.from({ length: 65 }, (_, i) => ` .field${i} = ${i}`).join('\n')}\nend\nState .field64`);
        expect(result.result).toBe('64');
        expect(result.diagnostics.compilerObservations.some(entry => entry.reasons.includes('value-expression:field-budget'))).toBe(true);
    });
});
