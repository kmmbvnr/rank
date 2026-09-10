import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { LocalFrame } from '../src/frame.js';

describe('runtime fast paths', () => {
    it('keeps cached standard functions behind variable and module lookup', () => {
        const runtime = new Interpreter();
        expect(runtime.execute(`
use numbers
fun positive X
  Result = X abs
  return Result
end
-3 positive
abs equal abs
`)).toBe(true);
        expect(runtime.execute('7 positive')).toBe(7n);
        runtime.execute(`
fun replacement X
  return X + 100
end
`);
        runtime.variables.set('abs', runtime.variables.get('replacement')!);
        expect(runtime.execute('7 positive')).toBe(107n);
        runtime.variables.delete('abs');
        expect(runtime.execute('-7 positive')).toBe(7n);
        runtime.modules.delete('numbers');
        expect(() => runtime.execute('7 positive')).toThrow('unknown name: abs');
    });

    it('evaluates simple-call operands once and retains addressing fallback', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line));
        expect(runtime.execute(`
use io
use numbers
fun add A B
  return A + B
end
Values = array 10 20
(1 print) (2 print) add
Values 1 abs
`)).toBe(20n);
        expect(output).toEqual(['1', '2']);
        expect(runtime.execute('Values 0')).toBe(10n);
    });

    it('does not reserve a local binding before its first assignment', () => {
        const runtime = new Interpreter();
        runtime.execute(`
Value = 50
fun pick N
  if N equal 0
    return Value
  end
  Value = 7
  return Value
end
`);
        expect(runtime.execute('1 pick')).toBe(7n);
        expect(runtime.execute('0 pick')).toBe(50n);
        expect(runtime.execute('Value')).toBe(50n);
    });

    it('resets local bindings and parameter types at a self-tail replacement', () => {
        const runtime = new Interpreter(undefined, { maxCallDepth: 1 });
        expect(runtime.execute(`
Value = 50
fun pick N X
  if N equal 0
    return Value
  end
  Value = 7
  return 0 "text" pick
end
1 99 pick
`)).toBe(50n);
        expect(runtime.execute('0 true pick')).toBe(50n);
    });

    it('retains inferred types within a slotted invocation', () => {
        const runtime = new Interpreter();
        expect(() => runtime.execute(`
fun wrong N
  Value = N
  Value = "text"
  return Value
end
1 wrong
`)).toThrow('Value has type integer and cannot receive text');
    });

    it('keeps escaped maps live and never resets captured frames', () => {
        const layout = new Map([['X', 0]]);
        const frame = new LocalFrame(undefined, layout);
        frame.set('X', 1n);
        expect(frame.read(0, 'X')).toBe(1n);
        const captured = frame.captures()[0];
        frame.set('X', 2n);
        expect(captured.get('X')).toBe(2n);
        captured.set('X', 3n);
        expect(frame.read(0, 'X')).toBe(3n);
        expect(frame.reset()).toBe(false);
        expect(frame.get('X')).toBe(3n);
    });

    it('does not share slotted values across frames with the same layout', () => {
        const layout = new Map<string, number>();
        const first = new LocalFrame(undefined, layout);
        const second = new LocalFrame(undefined, layout);
        first.set('X', 1n);
        expect(second.get('X')).toBeUndefined();
        second.set('X', 2n);
        expect(first.get('X')).toBe(1n);
        expect(second.reset()).toBe(true);
        expect(second.get('X')).toBeUndefined();
    });
});
