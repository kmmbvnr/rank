import { describe, expect, it, vi } from 'vitest';
import { Interpreter, type RankArray, type RankValue } from '../src/index.js';
import { LocalFrame } from '../src/frame.js';
import { BindingEnvironment } from '../src/binding-environment.js';

describe('runtime fast paths', () => {
    it('publishes lazy global arrays while checking rank and restores rejected writes', () => {
        const values = new Map<string, RankValue>();
        const frame = LocalFrame.over(values);
        frame.define('Count', 1n, new Set(['integer']));
        frame.set('Count', 2n);
        expect(values.get('Count')).toBe(2n);
        const original: RankArray = { kind: 'array', shape: [1], items: [1n] };
        frame.define('A', original, new Set(['array']));
        let observations = 0;
        const replacement: RankArray = {
            kind: 'array', items: [2n],
            get shape() {
                observations++;
                expect(values.get('A')).toBe(replacement);
                return [1, 1];
            },
        };
        expect(() => frame.set('A', replacement)).toThrow('has rank 1 and cannot receive rank 2');
        expect(observations).toBeGreaterThan(0);
        expect(values.get('A')).toBe(original);
        frame.set('Count', 3n);
        expect(values.get('Count')).toBe(3n);
    });

    it('keeps cached standard functions behind variable and module lookup', () => {
        const runtime = new Interpreter();
        expect(runtime.execute(`
use numbers
fun X positive
  Result = X abs
  return Result
end
-3 positive
abs equal abs
`)).toBe(true);
        expect(runtime.execute('7 positive')).toBe(7n);
        runtime.execute(`
fun X replacement
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
fun A add B
  return A + B
end
Values = array 10 20
(1 print) add (2 print)
Values 1 abs
`)).toBe(20n);
        expect(output).toEqual(['1', '2']);
        expect(runtime.execute('Values 0')).toBe(10n);
    });

    it('does not reserve a local binding before its first assignment', () => {
        const runtime = new Interpreter();
        runtime.execute(`
Value = 50
fun N pick
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
fun N pick X
  if N equal 0
    return Value
  end
  Value = 7
  return 0 pick "text"
end
1 pick 99
`)).toBe(50n);
        expect(runtime.execute('0 pick true')).toBe(50n);
    });

    it('retains inferred types within a slotted invocation', () => {
        const runtime = new Interpreter();
        expect(() => runtime.execute(`
fun N wrong
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

describe('prepared writers through block scopes', () => {
    it('reuses a global writer through nested blocks and retains type checks', () => {
        const values = new Map<string, RankValue>();
        const bindings = new BindingEnvironment(values, new Set());
        bindings.assign('Total', 0n);
        const outer = new LocalFrame(undefined, new Map(), new Set(['I']));
        bindings.current = new LocalFrame(outer, new Map(), new Set(['J']));
        const assign = vi.spyOn(bindings, 'assign');
        const write = bindings.compileAssign('Total');
        write(1n);
        write(2n);
        bindings.current = undefined;
        write(3n);
        expect(assign).toHaveBeenCalledTimes(1);
        expect(values.get('Total')).toBe(3n);
        expect(() => write('text')).toThrow('Total has type integer and cannot receive text');
        expect(values.get('Total')).toBe(3n);
    });

    it('selects the enclosing local slot anew when the invocation changes', () => {
        const bindings = new BindingEnvironment(new Map(), new Set());
        bindings.assign('Total', 99n);
        const layout = new Map([['Total', 0]]);
        const first = new LocalFrame(undefined, layout);
        const second = new LocalFrame(undefined, layout);
        first.define('Total', 1n, new Set(['integer']));
        second.define('Total', 10n, new Set(['integer']));
        const write = bindings.compileAssign('Total');
        const assign = vi.spyOn(bindings, 'assign');
        bindings.current = new LocalFrame(first, new Map(), new Set(['I']));
        write(2n);
        bindings.current = new LocalFrame(second, new Map(), new Set(['I']));
        write(11n);
        bindings.current = new LocalFrame(first, new Map(), new Set(['J']));
        write(3n);
        expect(assign).not.toHaveBeenCalled();
        expect(first.get('Total')).toBe(3n);
        expect(second.get('Total')).toBe(11n);
        expect(bindings.globals.get('Total')).toBe(99n);
        // An escaped/mapped frame must still use its checked ordinary writer.
        const captured = first.values;
        write(4n);
        expect(captured.get('Total')).toBe(4n);
    });

    it('keeps mutation protection installed after the global cache was warmed', () => {
        const bindings = new BindingEnvironment(new Map(), new Set());
        bindings.assign('Total', 0n);
        bindings.current = new LocalFrame(undefined, new Map(), new Set(['I']));
        const write = bindings.compileAssign('Total');
        write(1n);
        write(2n);
        bindings.protect('Total', 'Saved', '')();
        expect(() => { bindings.checkMutable('Total'); write(3n); }).toThrow();
        expect(bindings.globals.get('Total')).toBe(2n);
    });
});
