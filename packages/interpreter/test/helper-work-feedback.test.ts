import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse } from '../src/index.js';

const size = 150000;
const prefix = `use sequences
A = array shape ${size} fill 1
B = array shape ${size} fill 2`;

function expected() {
    let a = 1n, b = 2n, restA = 1n, restB = 2n;
    for (let i = 0; i < 5; i++) {
        b = (2n * (a + BigInt(size - 1) * restA)) % 1000003n;
        [a, b, restA, restB] = [b, a, restB, restA];
    }
    return a;
}

it.each([
    ['inline', '', '(A * 2) sum'],
    ['helper', "fun Input total\n Values' = Input * 2\n Result = Values sum\n return Result\nend", 'A total'],
    ['forwarded return', "fun Input inner\n Values' = Input * 2\n return Values sum\nend\nfun Input total\n return Input inner\nend", 'A total'],
])('keeps the large-copy limit independent of helper boundaries: %s', (_name, helpers, value) => {
    const program = parse(`${helpers}\n${prefix}
for R in 0 till 5
 B 0 = (${value}) mod 1000003
 unpack A B = tuple B A
end`);
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        const first = new RuntimeDiagnostics();
        first.run(() => runtime.executeProgram(program));
        expect(first.numberLoopCopyProbes).toBe(0);
        expect(first.costs['number-loop.snapshot']?.copiedBytes ?? 0).toBe(0);
        runtime.executeProgram(program);
        const warm = new RuntimeDiagnostics();
        warm.run(() => runtime.executeProgram(program));
        expect(runtime.execute('A 0')).toBe(expected());
        expect(warm.numberLoops).toBe(0);
        expect(warm.numberLoopOverflows).toBe(0);
        expect(warm.costs['number-loop.snapshot']?.copiedBytes ?? 0).toBe(0);
    } finally { runtime.dispose(); }
});

it('does not speculate on a large array with only a tiny consumer', () => {
    const program = parse(`fun Input firstvalue
 return Input 0
end
${prefix}
for R in 0 till 5
 B 0 = A firstvalue
 unpack A B = tuple B A
end`);
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => {
            for (let i = 0; i < 8; i++) runtime.executeProgram(program);
        });
        expect(runtime.execute('A 0')).toBe(1n);
        expect(diagnostics.numberLoopCopyProbes).toBe(0);
        expect(diagnostics.costs['number-loop.snapshot']?.copiedBytes ?? 0).toBe(0);
    } finally { runtime.dispose(); }
});
