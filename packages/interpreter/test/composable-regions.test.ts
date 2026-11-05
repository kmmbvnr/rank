import { expect, it, vi } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, parse } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
import { RankDeque } from '../src/containers.js';
import { native } from '../src/modules/shared.js';

const setup = `use sequences
fun X advance
 return X + 1
end
fun A atfirst
 return A 0 + 1
end
A = array shape 4 fill 1
B = array shape 4 fill 2
Saved = A
Total = 0`;

function run(body: string, compilation = true, prefix = setup, scope: (run: () => void) => void = run => run(), numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false, numberLoopCompilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(prefix);
        let error: string | undefined;
        try { scope(() => diagnostics.run(() => runtime.execute(body))); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, state: { error, values: ['A', 'B', 'Saved', 'Total'].map(name =>
            formatValue(runtime.variables.get(name)!)) } };
    } finally { runtime.dispose(); }
}

const moves = [
    'unpack A B = tuple B A',
    'Temp = A\n A = B\n B = Temp',
];

function call(source: string, compilation = true) {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
    try {
        return { value: formatValue(runtime.execute(source)!), calls };
    } finally { runtime.dispose(); }
}

it.each(['factors', 'divisors'])('composes a named %s recipe with local storage and a set', operation => {
    const source = `use numbers
use sequences
use algo
fun N collect
 Items' = N ${operation} unique
 Store = new set
 A = array shape 2 fill 0
 for P in Items
  Store add P
  A 0 += P
 end
 for P in Items
  if P in Store
   A 1 += P
  end
 end
 return A 0 + A 1
end
12 collect`;
    const actual = call(source);
    expect(actual.value).toBe(operation === 'factors' ? '10' : '56');
    expect(actual.value).toBe(call(source, false).value);
    expect(actual.calls).toBeGreaterThan(0);
});

it('composes array plans with writes to independent local storage', () => {
    const source = `use algo
fun Input collect
 Doubled' = Input * 2
 Store = new index
 A = array shape 2 fill 0
 A 0 = Doubled sum
 Store 0 = A 0
 A 1 = Doubled sum
 return Store 0 + A 1
end
(array 1 2 3) collect`;
    const actual = call(source);
    expect(actual.value).toBe('24');
    expect(actual.value).toBe(call(source, false).value);
    expect(actual.calls).toBeGreaterThan(0);
});

it('retains the read-only contract of a captured plan source', () => {
    const source = `use algo
fun N collect
 Store = new index
 A = array shape 3 fill N
 Doubled' = A * 2
 Store 0 = Doubled sum
 A 0 = 99
 return Store 0 + (Doubled sum) + A 0
end
2 collect`;
    for (const compilation of [false, true]) {
        expect(() => call(source, compilation)).toThrow('A is read-only because plan Doubled reads it');
    }
});

it('does not demand an unused failing recipe when composing with writes', () => {
    const source = `use algo
use numbers
use sequences
fun N collect
 Bad' = (N // 0) factors unique
 Store = new index
 A = array shape 1 fill 0
 Store 0 = N
 A 0 = Store 0 + 1
 return A 0
end
12 collect`;
    const actual = call(source);
    expect(actual.value).toBe('13');
    expect(actual.value).toBe(call(source, false).value);
    expect(actual.calls).toBe(1);
});

it.each(moves)('composes vector stages with array ownership: %s', move => {
    const source = `for R in 0 till 3
 B = A + 1
 B 0 = (B 0) advance
 ${move}
 Total += 9007199254740991
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.values).toEqual(['7 4 4 4', '5 3 3 3', '1 1 1 1', '27021597764222973']);
    expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
});

it('pins aliases created before the first vector stage across iterations', () => {
    const source = `for R in 0 till 4
 C = A
 A = B + 1
 B = A + 2
 A 0 += 1
 B 0 = C 0
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.numberLoops).toBe(1);
});

it.each(moves)('composes private moves with scalar calls: %s', move => {
    const source = `for R in 0 till 3
 for I in 0 till 4
  B I = (A I) advance
 end
 ${move}
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.values).toEqual(['4 4 4 4', '3 3 3 3', '1 1 1 1', '0']);
    expect(actual.diagnostics.numberLoops).toBe(1);
});

it.each(moves)('composes calls, exact outputs and moves together: %s', move => {
    const source = `for R in 0 till 3
 B 0 = (A 0) advance
 B 1 = B atfirst
 Total += 9007199254740991
 ${move}
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.values).toEqual(['4 5 2 2', '3 4 1 1', '1 1 1 1', '27021597764222973']);
    expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
});

it.each(moves)('replays the complete mixed transaction after a later cell overflow: %s', move => {
    const source = `for R in 0 till 3
 Total += 9007199254740991
 B 0 = (A 0) advance
 ${move}
 A 1 += 9007199254740991
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.state.values[3]).toBe('27021597764222973');
    expect(actual.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    expect(actual.diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
});

it.each(moves.flatMap(move => [false, true].map(after => ({ move, after }))))(
    'publishes preceding mixed writes when a helper fails: $move, $after', ({ move, after }) => {
        const source = `for R in 0 till 3
 Total += 9007199254740991
 B 0 = (A 0) advance
 ${after ? move : ''}
 B 2 = R fail
 ${after ? '' : move}
end`;
        const prefix = `${setup}\nfun X fail\n return 1 // (1 - X)\nend`;
        const actual = run(source, true, prefix);
        expect(actual.state).toEqual(run(source, false, prefix).state);
        expect(actual.state.error).toContain('division by zero');
        expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
    });

it('keeps captured reads outside the private transaction', () => {
    const prefix = `${setup}\nfun X observe\n return A 0 + X\nend`;
    const source = `for R in 0 till 3
 A 0 += 1
 B 0 = R observe
 unpack A B = tuple B A
end`;
    const actual = run(source, true, prefix);
    expect(actual.state).toEqual(run(source, false, prefix).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.numberLoops).toBe(0);
});

it.each([false, true])('composes helper effects transitively, captured=%s', captured => {
    const prefix = `${setup}
fun X inner
 return ${captured ? 'A 0' : 'X'} + 1
end
fun X outer
 return X inner
end`;
    const source = `for R in 0 till 3
 A 0 += 1
 B 0 = R outer
 unpack A B = tuple B A
end`;
    const actual = run(source, true, prefix);
    expect(actual.state).toEqual(run(source, false, prefix).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.numberLoops).toBe(captured ? 0 : 1);
});

it.each(['return X + 1', 'Scratch = array shape 2 fill X\n Scratch 0 += 1\n return Scratch 0'])(
    'invalidates a warmed private-call proof when a nested helper is replaced: %s', helper => {
    function execute(compilation: boolean) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        try {
            const program = parse(`${setup.replace('return X + 1', helper)}\nfun X advanceagain\n return X advance\nend
for R in 0 till 3
 B 0 = (A 0) advanceagain
 unpack A B = tuple B A
end`);
            runtime.executeProgram(program);
            const body = { ...program, statements: [program.statements.at(-1)!] };
            runtime.variables.set('advance', native('replacement', 1, () => {
                runtime.execute('A 0 += 5');
                return 9n;
            }));
            const diagnostics = new RuntimeDiagnostics();
            diagnostics.run(() => runtime.executeProgram(body));
            return { values: ['A', 'B', 'Saved'].map(name => formatValue(runtime.variables.get(name)!)),
                numberLoops: diagnostics.numberLoops };
        } finally { runtime.dispose(); }
    }
    const actual = execute(true);
    expect(actual.values).toEqual(execute(false).values);
    expect(actual.numberLoops).toBe(0);
});

it('keeps custom polling on the observable path', () => {
    const source = `for R in 0 till 3
 B 0 = A atfirst
 Total += 9007199254740991
 unpack A B = tuple B A
end`;
    const scope = (execute: () => void) => {
        withInterrupt({ length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} }, execute);
    };
    const actual = run(source, true, setup, scope);
    expect(actual.state).toEqual(run(source, true, setup, scope, false).state);
    expect(actual.diagnostics.numberLoops).toBe(0);
});

it.each([1, 12, 30])('retains demand boundaries at budget %s', budget => {
    const source = `for R in 0 till 3
 B 0 = A atfirst
 Total += 9007199254740991
 unpack A B = tuple B A
end`;
    const scope = (execute: () => void) => withDemandBudget(budget, execute);
    const actual = run(source, true, setup, scope);
    expect(actual.diagnostics.numberLoops).toBe(0);
    // Budget units differ between engines. Compare the publishing backend.
    expect(actual.state).toEqual(run(source, true, setup, scope, false).state);
});

it.each(moves)('composes private moves with read-only array calls: %s', move => {
    const source = `for R in 0 till 3
 B 0 = A atfirst
 ${move}
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.values).toEqual(['4 2 2 2', '3 1 1 1', '1 1 1 1', '0']);
    expect(actual.diagnostics.numberLoops).toBe(1);
});

it.each(moves)('composes private moves with exact scalar outputs: %s', move => {
    const source = `for R in 0 till 3
 B 0 = A 0 + 1
 Total += 9007199254740991
 ${move}
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.values).toEqual(['4 2 2 2', '3 1 1 1', '1 1 1 1', '27021597764222973']);
    expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
});

it.each(['1 till 1', '3 to 0', '0 to 3 by -1', '1 till 1 by -1'])(
    'does not detach an alias for an empty range: %s', range => {
        const source = `for R in 0 till 2
 Temp = B
 for I in ${range}
  B I = (A I) advance
 end
 Temp = A
end`;
        const actual = run(source);
        expect(actual.state).toEqual(run(source, false).state);
        expect(actual.state.error).toBeUndefined();
        expect(actual.diagnostics.numberLoops).toBe(1);
        expect(actual.diagnostics.costs['number-loop.alias-copy']?.copiedBytes ?? 0).toBe(0);
    });

it.each(['0 to 3', '3 to 0 by -1', '0 till 4', '3 till -1 by -1'])(
    'detaches a stable alias once for a nonempty range: %s', range => {
        const source = `for R in 0 till 2
 Temp = B
 for I in ${range}
  B I = (A I) advance
 end
 A 0 = Temp 0
end`;
        const actual = run(source);
        expect(actual.state).toEqual(run(source, false).state);
        expect(actual.state.error).toBeUndefined();
        expect(actual.diagnostics.numberLoops).toBe(1);
        expect(actual.diagnostics.costs['number-loop.alias-copy']?.copiedBytes).toBe(32);
    });

it.each(['A', 'B'])('refreshes inner range guards after rebinding %s outside the traversal', name => {
    const source = `for R in 0 till 3
 for I in 0 till 4
  B I = (A I) advance
 end
 Total += 9007199254740991
 Temp = A
 A = B
 B = Temp
 ${name} = array shape (4 - R) fill 1
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.error).toBeDefined();
    expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
});

it.each(['A', 'B'])('keeps per-cell bounds when %s is rebound inside the traversal', name => {
    const source = `for R in 0 till 3
 for I in 0 till 4
  B I = (A I) advance
  ${name} = array shape (4 - I) fill 1
 end
 Total += 9007199254740991
 Temp = A
 A = B
 B = Temp
end`;
    const actual = run(source);
    expect(actual.state).toEqual(run(source, false).state);
    expect(actual.state.error).toBeDefined();
    expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
});

it('scopes helper diagnostics to each observation across reused region calls', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    const program = parse(`${setup}
for R in 0 till 3
 for I in 0 till 4
  B I = (A I) advance
 end
 Temp = A
 A = B
 B = Temp
 Total += 9007199254740991
end
(A sum) + Total`);
    const first = new RuntimeDiagnostics();
    const second = new RuntimeDiagnostics();
    const expected = 27021597764222989n;
    try {
        expect(runtime.executeProgram(program)).toBe(expected);
        expect(first.run(() => runtime.executeProgram(program))).toBe(expected);
        expect(first.numberFunctions).toBe(12);
        expect(runtime.executeProgram(program)).toBe(expected);
        expect(second.run(() => runtime.executeProgram(program))).toBe(expected);
        expect(second.numberFunctions).toBe(12);
        expect(first.numberFunctions).toBe(12);
        expect(runtime.executeProgram(program)).toBe(expected);
        expect(second.numberFunctions).toBe(12);
    } finally { runtime.dispose(); }
});

it.each(['2147483648', '-2147483649', '9007199254740991', '9007199254740992'])(
    'preserves late snapshot widening and exact replay for %s', value => {
        const prefix = `${setup}\nA = array 1 2 3 ${value}\nSaved = A`;
        const body = `for R in 0 till 2
 for I in 0 till 4
  B I = (A I) advance
 end
 Temp = A
 A = B
 B = Temp
 Total += 9007199254740991
end`;
        expect(run(body, true, prefix).state).toEqual(run(body, false, prefix).state);
    });

it('rechecks call depth when a cached leaf enters a nested region', () => {
    function execute(compilation: boolean) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false, maxCallDepth: 1 });
        const body = `A = array shape 4 fill 1
B = array shape 4 fill 2
for R in 0 till 3
 for I in 0 till 4
  B I = (A I) advance
 end
 unpack A B = tuple B A
end`;
        try {
            runtime.execute('fun X advance\n return X + 1\nend');
            runtime.execute(body);
            runtime.execute(`fun N worker\n${body}\n return A sum\nend`);
            let error: string | undefined;
            try { runtime.execute('1 worker'); }
            catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
            runtime.execute(body);
            return { error, value: formatValue(runtime.variables.get('A')!) };
        } finally { runtime.dispose(); }
    }
    const actual = execute(true);
    expect(actual).toEqual(execute(false));
    expect(actual.error).toContain('function call depth exceeds 1');
    expect(actual.value).toBe('4 4 4 4');
});

it('retains helper error frames and preceding writes without diagnostics', () => {
    function execute(compilation: boolean) {
        const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
        try {
            runtime.execute(`${setup}\nfun X fail\n return 1 // (1 - X)\nend`);
            let error: string | undefined;
            try { runtime.execute(`for R in 0 till 3
 for I in 0 till 4
  B I = (A I) advance
 end
 Total += 9007199254740991
 unpack A B = tuple B A
 B 2 = R fail
end`); }
            catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
            return { error, values: ['A', 'B', 'Saved', 'Total'].map(name => formatValue(runtime.variables.get(name)!)) };
        } finally { runtime.dispose(); }
    }
    const actual = execute(true);
    expect(actual).toEqual(execute(false));
    expect(actual.error).toContain('division by zero');
});

const scratchHelpers = [
    `Scratch = array shape 2 fill X
 Scratch 0 += 1
 return Scratch 0`,
    `Queue = new queue
 Queue push X
 Value = Queue pop
 return Value + 1`,
    `Store = new index
 Store 0 = X + 1
 return Store 0`,
    `Store = new set
 Store add X
 if X in Store
  return X + 1
 end
 return 0`,
];

it.each(scratchHelpers)('composes helper-owned storage with private moves: %s', helper => {
    const prefix = `${setup}
use algo
fun X scratch
 ${helper}
end
fun X linked
 return X scratch
end`;
    const body = `for R in 0 till 3
 B 0 = (A 0) linked
 Total += 9007199254740991
 unpack A B = tuple B A
end`;
    const actual = run(body, true, prefix);
    expect(actual.state).toEqual(run(body, false, prefix).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
});

it('maps a linked container write to caller-owned storage', () => {
    const prefix = `${setup}
use algo
fun Store storevalue X
 Store 0 = X + 1
 return Store 0
end
fun X scratch
 Store = new index
 return Store storevalue X
end`;
    const body = `for R in 0 till 3
 B 0 = (A 0) scratch
 unpack A B = tuple B A
end`;
    const actual = run(body, true, prefix);
    expect(actual.state).toEqual(run(body, false, prefix).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.numberLoops).toBe(1);
});

it.each(scratchHelpers)('replays local-storage helpers after caller overflow: %s', helper => {
    const prefix = `${setup}
use algo
fun X scratch
 ${helper}
end`;
    const body = `for R in 0 till 3
 B 0 = (A 0) scratch
 Total += 9007199254740991
 unpack A B = tuple B A
 A 1 += 9007199254740991
end`;
    const actual = run(body, true, prefix);
    expect(actual.state).toEqual(run(body, false, prefix).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    expect(actual.diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
});

it('preserves the error and preceding writes from a failing scratch helper', () => {
    const prefix = `${setup}
fun X scratch
 Scratch = array shape 2 fill X
 Scratch 0 = 1 // (1 - X)
 return Scratch 0
end`;
    const body = `for R in 0 till 3
 A 0 += 1
 Total += 9007199254740991
 B 0 = R scratch
 unpack A B = tuple B A
end`;
    const actual = run(body, true, prefix);
    expect(actual.state).toEqual(run(body, false, prefix).state);
    expect(actual.state.error).toContain('division by zero');
    expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
});

it('does not hide a write through an aliased container parameter', () => {
    const prefix = `${setup}
use algo
Store = new index
Store 0 = 0
fun Store changevalue X
 Alias = Store
 Alias 0 += X
 return Alias 0
end`;
    const body = `for R in 0 till 3
 B 0 = Store changevalue (A 0)
 Total += B 0
 unpack A B = tuple B A
end`;
    const actual = run(body, true, prefix);
    expect(actual.state).toEqual(run(body, false, prefix).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.numberLoops).toBe(0);
});

it('rechecks local queue methods through a linked helper', () => {
    const prefix = `${setup}
use algo
fun X scratch
 ${scratchHelpers[1]}
end
fun X linked
 return X scratch
end`;
    const body = `for R in 0 till 3
 A 0 += 1
 B 0 = (A 0) linked
 unpack A B = tuple B A
end`;
    const push = RankDeque.prototype.push;
    const spy = vi.spyOn(RankDeque.prototype, 'push').mockImplementation(function (this: RankDeque, value) {
        return push.call(this, value);
    });
    try {
        const actual = run(body, true, prefix);
        expect(actual.state).toEqual(run(body, false, prefix).state);
        expect(actual.state.error).toBeUndefined();
        expect(actual.diagnostics.numberLoops).toBe(0);
        expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
});

it('borrows the current caller array into a helper with private scratch storage', () => {
    const prefix = `${setup}
fun Input scratch
 Scratch = array shape 2 fill 0
 Scratch 0 = Input 0 + 1
 return Scratch 0
end`;
    const body = `for R in 0 till 3
 A 0 += 1
 B 0 = A scratch
 unpack A B = tuple B A
end`;
    const actual = run(body, true, prefix);
    expect(actual.state).toEqual(run(body, false, prefix).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.diagnostics.numberLoops).toBe(1);
});

it('keeps wide helper results exact without replaying the caller prefix', () => {
    const prefix = `${setup}
fun X scratch
 Scratch = array shape 2 fill X
 Scratch 0 *= 9007199254740991
 return Scratch 0
end`;
    const body = `for R in 1 to 4
 B 0 += 1
 Total += R scratch // R
 unpack A B = tuple B A
end`;
    const actual = run(body, true, prefix);
    expect(actual.state).toEqual(run(body, false, prefix).state);
    expect(actual.state.error).toBeUndefined();
    expect(actual.state.values[3]).toBe('36028797018963964');
    expect(actual.diagnostics.mixedIntegerLoops).toBe(1);
    expect(actual.diagnostics.numberLoopOverflows).toBe(0);
});
