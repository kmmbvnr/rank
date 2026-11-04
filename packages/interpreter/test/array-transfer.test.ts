import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, isRankTuple, isRankArray } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
import { readArrayItem } from '../src/array-storage.js';

const initial = `use sequences
A = array shape 4 fill 1
B = array shape 4 fill 2
Saved = A`;
const rotation = `for R in 1 to 3
 for I in 0 till 4
  B I = A I + 1
 end
 unpack A B = tuple B A
end`;
function run(source: string, compilation = true, setup = initial, names = ['A', 'B', 'Saved'], budget?: number, options = {}) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false, ...options });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(setup);
        let error: string | undefined, value;
        try { value = diagnostics.run(() => budget === undefined ? runtime.execute(source)
            : withDemandBudget(budget, () => runtime.execute(source))); }
        catch (failure) { error = String(failure); }
        return { diagnostics, state: { error, result: value === undefined ? undefined : formatValue(value),
            arrays: names.map(name => runtime.variables.has(name) ? formatValue(runtime.variables.get(name)!) : undefined) } };
    } finally { runtime.dispose(); }
}

it('moves two private buffers and publishes the final tuple', () => {
    const result = run(rotation);
    expect(result.state.error).toBeUndefined();
    expect(result.state).toEqual(run(rotation, false).state);
    expect(result.state.arrays).toEqual(['4 4 4 4', '3 3 3 3', '1 1 1 1']);
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('retains the published tuple when a later statement writes a binding', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute(initial);
        const result = runtime.execute(rotation);
        if (!result || !isRankTuple(result)) throw new Error('expected tuple');
        const first = result.items[0];
        if (!isRankArray(first)) throw new Error('expected array');
        runtime.execute('A 0 = 99');
        expect(readArrayItem(first, 0)).toBe(4n);
        expect(runtime.execute('A 0')).toBe(99n);
    } finally { runtime.dispose(); }
});

function compare(source: string, setup = initial, names = ['A', 'B', 'Saved']) {
    const result = run(source, true, setup, names);
    expect(result.state).toEqual(run(source, false, setup, names).state);
    return result;
}

it('moves arbitrary permutations with independently changing lengths', () => {
    const setup = `use sequences
A = array shape 2 fill 1
B = array shape 3 fill 2
C = array shape 4 fill 3`;
    const result = compare(`for R in 0 till 5
 A 0 += 1
 unpack A B C = tuple C A B
end`, setup, ['A', 'B', 'C']);
    expect(result.state.error).toBeUndefined();
    expect(result.state.arrays).toEqual(['3 2 2', '5 3 3 3', '3 1']);
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('refreshes multidimensional shapes after parallel moves', () => {
    const result = compare(`for R in 0 till 3
 A 1 0 += 1
 unpack A B = tuple B A
end`, `use sequences
A = array shape 2 3 fill 1
B = array shape 3 2 fill 2
Saved = A`);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('keeps entry aliases independent when only one destination is written', () => {
    const result = compare(rotation, initial.replace('B = array shape 4 fill 2', 'B = A'));
    expect(result.state.error).toBeUndefined();
    expect(result.state.arrays).toEqual(['4 4 4 4', '3 3 3 3', '1 1 1 1']);
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('moves real buffers without integer conversion', () => {
    const result = compare(rotation.replace('+ 1', '+ 0.5'), initial.replace('fill 1', 'fill 1.5').replace('fill 2', 'fill 2.5'));
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('widens moved Int32 storage before later reads', () => {
    const result = compare(rotation.replace('+ 1', '+ 2147483647'));
    expect(result.state.error).toBeUndefined();
    expect(result.state.arrays[0]).toBe('6442450942 6442450942 6442450942 6442450942');
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('rolls back all transferred buffers before exact overflow replay', () => {
    const result = compare(rotation.replace('+ 1', '+ 9007199254740991'));
    expect(result.state.error).toBeUndefined();
    expect(result.state.arrays[0]).toBe('27021597764222974 27021597764222974 27021597764222974 27021597764222974');
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});

it.each([false, true])('publishes partial state when error follows move: %s', after => {
    const source = after ? rotation.replace('tuple B A', 'tuple B A\n A 9 = 0')
        : rotation.replace(' unpack', ' B 9 = 0\n unpack');
    const result = compare(source);
    expect(result.state.error).toContain('array index out of bounds');
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('handles conditional transfers and empty loops', () => {
    const conditional = rotation.replace(' unpack A B = tuple B A', ' if R less 3\n  unpack A B = tuple B A\n end');
    expect(compare(conditional).state.error).toBeUndefined();
    expect(compare(rotation.replace('1 to 3', '1 till 1')).state.error).toBeUndefined();
});

it.each([' unpack A B = tuple A A', ' unpack A B = tuple B A\n break'])('retains fallback for unsafe transfers: %s', replacement => {
    const source = rotation.replace(' for I in 0 till 4\n  B I = A I + 1\n end', ' B 0 = A 0 + 1');
    const result = compare(source.replace(' unpack A B = tuple B A', replacement));
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(0);
});

it('retains observable demand boundaries', () => {
    const result = run(rotation, true, initial, ['A', 'B', 'Saved'], 12);
    expect(result.state).toEqual(run(rotation, true, initial, ['A', 'B', 'Saved'], 12, { numberLoopCompilation: false }).state);
    expect(result.state.error).toContain('demand budget exhausted');
});

it('revalidates cached regions after rebinding entry arrays', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute(initial);
        for (let i = 0; i < 3; i++) {
            const stats = new RuntimeDiagnostics();
            stats.run(() => runtime.execute(rotation));
            expect(runtime.execute('A 0')).toBe(BigInt(4 + 3 * i));
            expect(stats.numberLoops).toBe(1);
        }
    } finally { runtime.dispose(); }
});

it('moves freshly allocated local buffers', () => {
    const result = compare(`for R in 0 till 3
 A = array shape 4 fill R
 B = array shape 4 fill 0
 B 0 = A 0 + 1
 unpack A B = tuple B A
end`);
    expect(result.state.error).toBeUndefined();
    expect(result.state.arrays).toEqual(['3 0 0 0', '2 2 2 2', '1 1 1 1']);
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('does not retain stale bounds after moving a shorter buffer', () => {
    const result = compare(`for R in 0 till 3
 A 3 = R
 unpack A B = tuple B A
end`, initial.replace('B = array shape 4', 'B = array shape 2'));
    expect(result.state.error).toContain('array index out of bounds');
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('publishes an atomic cancellation between moves without touching entry snapshots', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    const stats = new RuntimeDiagnostics(), flag = new Int32Array(1);
    try {
        runtime.execute(initial);
        flag[0] = 1;
        expect(() => withInterrupt(flag, () => stats.run(() => runtime.execute(`for R in 0 till 10000
 B 0 = A 0 + 1
 unpack A B = tuple B A
end`)))).toThrow('Interrupted');
        const a = runtime.execute('A 0') as bigint, b = runtime.execute('B 0') as bigint;
        expect(a).toBeGreaterThan(1n);
        expect(a).toBeLessThan(10001n);
        expect(a - b).toBe(1n);
        expect(runtime.execute('Saved 0')).toBe(1n);
        expect(stats.numberLoopBatched).toBe(1);
    } finally { runtime.dispose(); }
});

it('keeps sequential swap temporaries as observable snapshots', () => {
    const source = rotation.replace(' unpack A B = tuple B A', ' Temp = A\n A = B\n B = Temp');
    const result = compare(source, initial + '\nTemp = B', ['A', 'B', 'Saved', 'Temp']);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('preserves aliases while writing either end of a chain', () => {
    const result = compare(`for R in 0 till 3
 C = A
 D = C
 A 0 += 1
 C 1 += 2
 D 2 += 3
end`, initial + '\nC = B\nD = B', ['A', 'B', 'Saved', 'C', 'D']);
    expect(result.state.error).toBeUndefined();
    expect(result.state.arrays).toEqual(['4 1 1 1', '2 2 2 2', '1 1 1 1', '3 3 1 1', '3 1 4 1']);
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('releases overwritten aliases before the next write', () => {
    const result = compare(`for R in 0 till 3
 C = A
 C = B
 A 0 += 1
end`, initial + '\nC = B', ['A', 'B', 'Saved', 'C']);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
    expect(result.diagnostics.costs['number-loop.alias-copy']).toBeUndefined();
});

it('publishes both old aliases and current cells on an error', () => {
    const result = compare(`for R in 0 till 3
 C = A
 A 0 += 1
 A 9 = 0
end`, initial + '\nC = B', ['A', 'B', 'Saved', 'C']);
    expect(result.state.error).toContain('array index out of bounds');
    expect(result.state.arrays).toEqual(['2 1 1 1', '2 2 2 2', '1 1 1 1', '1 1 1 1']);
    expect(result.diagnostics.numberLoops).toBe(1);
});

it.each(['1', '1.5'])('detaches shared buffers of numeric kind %s', fill => {
    const result = compare(`for R in 0 till 3
 C = A
 A 0 = A 0 + 2147483647
 C 1 = C 1 + 2
end`, initial.replace('fill 1', `fill ${fill}`) + '\nC = A', ['A', 'B', 'Saved', 'C']);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('keeps ownership through conditional aliases and parallel moves', () => {
    const result = compare(`for R in 0 till 4
 C = A
 if R mod 2 equal 0
  C = B
 end
 unpack A B = tuple B A
 A 0 += 1
 C 1 += 2
end`, initial + '\nC = B', ['A', 'B', 'Saved', 'C']);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('discards alias copies on exact overflow replay', () => {
    const result = compare(`for R in 0 till 3
 C = A
 A 0 += 1
 C 1 += 9007199254740991
end`, initial + '\nC = B', ['A', 'B', 'Saved', 'C']);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
});

it('tracks owners through matrix aliases and changing dimensions', () => {
    const result = compare(`for R in 0 till 3
 C = A
 A 1 0 += 1
 A = B
 B = C
 B 1 1 += 2
end`, `A = array shape 2 3 fill 1
B = array shape 3 2 fill 2
C = A
Saved = A`, ['A', 'B', 'Saved', 'C']);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});

it('retains fallback for shared local slice stores', () => {
    const result = compare(`for R in 0 till 3
 A = array shape 4 fill R
 C = A
 A (0 to 2) = 9
end`, initial + '\nC = B', ['A', 'B', 'Saved', 'C']);
    expect(result.state.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(0);
});

it('retains a final alias result across a later external store', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute(initial + '\nC = B');
        const result = runtime.execute(`for R in 0 till 3
 C = A
 A 0 += 1
 C = A
end`);
        if (!result || !isRankArray(result)) throw new Error('expected array');
        expect(readArrayItem(result, 0)).toBe(4n);
        runtime.execute('A 0 = 99');
        expect(readArrayItem(result, 0)).toBe(4n);
        expect(runtime.execute('C 0')).toBe(4n);
    } finally { runtime.dispose(); }
});

it('retains observable demand boundaries for alias regions', () => {
    const source = rotation.replace(' for I in 0 till 4\n  B I = A I + 1\n end', ' B 0 = A 0 + 1')
        .replace(' unpack A B = tuple B A', ' Temp = A\n A = B\n B = Temp');
    const setup = initial + '\nTemp = B';
    const names = ['A', 'B', 'Saved', 'Temp'];
    const result = run(source, true, setup, names, 12);
    expect(result.state).toEqual(run(source, true, setup, names, 12, { numberLoopCompilation: false }).state);
    expect(result.state.error).toContain('demand budget exhausted');
});

it('preserves aliases when cancellation occurs after ownership detachment', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    const stats = new RuntimeDiagnostics(), flag = new Int32Array(1);
    try {
        runtime.execute(initial + '\nC = B');
        flag[0] = 1;
        expect(() => withInterrupt(flag, () => stats.run(() => runtime.execute(`for R in 0 till 10000
 C = A
 A 0 += 1
end`)))).toThrow('Interrupted');
        expect(runtime.execute('A 0 - C 0')).toBe(1n);
        expect(runtime.execute('Saved 0')).toBe(1n);
        expect(stats.numberLoopBatched).toBe(1);
    } finally { runtime.dispose(); }
});
