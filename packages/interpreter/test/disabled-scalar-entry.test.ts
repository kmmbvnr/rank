import { expect, it, vi } from 'vitest';
import { Interpreter } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';
import * as arguments_ from '../src/jit/compiled-argument-type.js';
import { answerOf } from './support.js';

const helper = `use algo
fun N populate Store
  for I in 1 to N
    Store add I
  end
  return 1
end`;
const call = `Seen = new set
Answer = 3 populate Seen
Answer += Seen sum`;

it.each([{compilation: false}, {scalarEntryCompilation: false}])(
    'skips compiled storage proofs with disabled entries: %j', options => {
        const proof = vi.spyOn(arguments_, 'compiledEntryArgumentType');
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.execute(helper);
            proof.mockClear();
            runtime.execute(call);
            expect(answerOf(runtime)).toBe(7n);
            expect(proof).not.toHaveBeenCalled();
        } finally {runtime.dispose(); proof.mockRestore();}
    },
);

it.each([false, true])('restores compiled container entries after inspection, definition inspected=%s', inspected => {
    let compiled = 0;
    const runtime = new Interpreter(() => {}, {onScalarFunctionExecuted: () => compiled++});
    const signal = new Int32Array(new SharedArrayBuffer(12));
    try {
        if (inspected) withInterrupt(signal, () => runtime.execute(helper), () => {});
        else runtime.execute(helper);
        withInterrupt(signal, () => runtime.execute(call), () => {});
        expect(answerOf(runtime)).toBe(7n);
        expect(compiled).toBe(0);
        runtime.execute(call);
        expect(answerOf(runtime)).toBe(7n);
        expect(compiled).toBeGreaterThan(0);
    } finally {runtime.dispose();}
});


it('checks a mutable entry argument once per invocation', () => {
    const proof = vi.spyOn(arguments_, 'compiledEntryArgumentType');
    let compiled = 0;
    const runtime = new Interpreter(() => {}, {
        onScalarFunctionExecuted: () => compiled++,
    });
    try {
        runtime.execute(helper);
        runtime.execute('Seen = new set');
        const store = runtime.variables.get('Seen');
        for (let i = 0; i < 2; i++) {
            proof.mockClear();
            runtime.execute('Answer = 3 populate Seen');
            expect(answerOf(runtime)).toBe(1n);
            expect(proof.mock.calls.filter(([value]) => value === store)).toHaveLength(1);
        }
        expect(compiled).toBe(2);
    } finally { runtime.dispose(); proof.mockRestore(); }
});
