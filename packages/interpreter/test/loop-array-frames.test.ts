import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { RankDeque } from '../src/containers.js';

function run(source: string, compilation: boolean, setup?: (runtime: Interpreter) => void) {
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { compilation });
    const diagnostics = new RuntimeDiagnostics();
    let value: string | undefined, error: string | undefined;
    try {
        setup?.(runtime);
        const result = diagnostics.run(() => runtime.execute(source));
        value = result === undefined ? undefined : formatValue(result);
    } catch (caught) {
        if (!(caught instanceof RankError)) throw caught;
        error = caught.format();
    }
    const variables = [...runtime.variables].map(([name, item]) => [name, formatValue(item)]);
    runtime.dispose();
    return { result: { value, error, output, variables }, loops: diagnostics.compiledLoops, diagnostics };
}

function compare(source: string, setup?: (runtime: Interpreter) => void) {
    const reference = run(source, false, setup), compiled = run(source, true, setup);
    expect(compiled.result).toEqual(reference.result);
    return compiled;
}

describe('compiled scalar array frames', () => {
    it.each(['stack', 'queue', 'deque'])('grows and unpacks %s frames in one region', kind => {
        const result = compare(`use algo
Todo = new ${kind}
Todo push array 1 0
Total = 0
for Todo len greater 0
 Frame = Todo pop
 unpack P Depth = Frame
 Total += P
 if Depth less 4
  for F in 2 to 3
   Todo push array (P * F) (Depth + 1)
  end
 end
end
Total`);
        expect(result.result.value).toBe('781');
        expect(result.loops).toBe(1);
    });

    it('keeps array-valued loop results and unpack placeholders', () => {
        const result = compare(`A = array 1 2 3
for I in 1 to 2
 unpack X # X = A
end`);
        expect(result.result.value).toBe('1 2 3');
        expect(result.loops).toBe(1);
    });

    it('checks unpack arity after pop and before any target assignment', () => {
        const result = compare(`use algo
Todo = new stack
Todo push array 1 2
A = 9
B = 8
for Todo len greater 0
 Frame = Todo pop
 unpack A B C = Frame
end`);
        expect(result.result.error).toContain('unpack expects 3 values, got 2');
        expect(result.loops).toBe(1);
    });

    it('snapshots targets before stores and retains earlier stores on a binding error', () => {
        const result = compare(`A = array 1 2
X = 0
Y = "text"
for I in 1 to 2
 unpack X Y = A
end`);
        expect(result.result.error).toBeDefined();
        expect(result.loops).toBe(1);
        expect(result.result.variables).toContainEqual(['X', '1']);
    });

    it('preserves queued snapshots when a popped array is mutated', () => {
        const result = compare(`use algo
Todo = new stack
Seed = array 1 2
Todo push Seed
Todo push Seed
Total = 0
for Todo len greater 0
 Frame = Todo pop
 unpack P Q = Frame
 Frame 0 = 9
 Total += P + Q
end
Total`);
        expect(result.result.value).toBe('6');
        expect(result.loops).toBe(0);
    });

    it('preserves signed cells and operand order in literal arrays', () => {
        const result = compare(`A = array 0 0 0
X = 0
Y = 0
Z = 0
for I in 1 to 2
 A = array I (-I) (I + 1)
 unpack X Y Z = A
end
X + Y + Z`);
        expect(result.result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it.each(['integer', 'real', 'boolean', 'text'])('unpacks homogeneous %s literals', type => {
        const cells = { integer: '2 3', real: '2.5 3.5', boolean: 'true false', text: '"two" "three"' }[type]!;
        const result = compare(`for I in 1 to 2
 unpack P Q = array ${cells}
end`);
        expect(result.result.error).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('retains snapshot semantics when a named pushed array is subsequently changed', () => {
        const result = compare(`use algo
Todo = new stack
for I in 1 to 2
 Frame = array I I
 Todo push Frame
 Frame 0 = 99
end
Old = Todo pop
Old 0`);
        expect(result.result.value).toBe('2');
        expect(result.loops).toBe(0);
    });

    it('keeps copy-on-write through a popped frame alias', () => {
        const result = compare(`use algo
Todo = new stack
Seed = array 1 2
Todo push Seed
for Todo len greater 0
 Frame = Todo pop
 Alias = Frame
 Alias 0 = 9
end
Seed 0`);
        expect(result.result.value).toBe('1');
        expect(result.loops).toBe(0);
    });

    it.each(['A', 'Alias'])('keeps local array snapshots when writing %s', target => {
        const result = compare(`Total = 0
for I in 1 to 2
 A = array 1 2
 Alias = A
 ${target} 0 = 9
 Total += ${target === 'A' ? 'Alias' : 'A'} 0
end
Total`);
        expect(result.result.value).toBe('2');
        expect(result.loops).toBe(0);
    });

    it('preserves the error and completed stores when a second pop exhausts the stack', () => {
        const result = compare(`use algo
Todo = new stack
Todo push array 1 2
Total = 0
for Todo len greater 0
 Frame = Todo pop
 unpack P Q = Frame
 Total += P + Q
 Another = Todo pop
end`);
        expect(result.result.error).toContain('stack is empty');
        expect(result.result.variables).toContainEqual(['Total', '3']);
        expect(result.loops).toBe(1);
    });

    it('does not move a later cell error before an earlier completed assignment', () => {
        const result = compare(`A = array 0 0
Done = 0
for I in 1 to 2
 Done = I
 A = array I (1 // (2 - I))
end`);
        expect(result.result.error).toContain('division by zero');
        expect(result.result.variables).toContainEqual(['Done', '2']);
        expect(result.result.variables).toContainEqual(['A', '1 1']);
        expect(result.loops).toBe(1);
    });

    it('allows varying frame lengths and fails only when unpack reaches the wrong one', () => {
        const result = compare(`use algo
Todo = new queue
Todo push array 1 2
Todo push array 3
Total = 0
for Todo len greater 0
 Frame = Todo pop
 unpack P Q = Frame
 Total += P + Q
end`);
        expect(result.result.error).toContain('unpack expects 2 values, got 1');
        expect(result.result.variables).toContainEqual(['Total', '3']);
        expect(result.loops).toBe(1);
    });

    it('guards host deque overrides before compiled pop', () => {
        const result = compare(`use algo
Total = 0
for Todo len greater 0
 Frame = Todo pop
 unpack P Q = Frame
 Total += P + Q
end
Total`, runtime => {
            const deque = new RankDeque('stack');
            const seed = runtime.execute('array 2 3')!;
            deque.push(seed);
            deque.pop = () => { RankDeque.prototype.pop.call(deque); return seed; };
            runtime.variables.set('Todo', deque);
        });
        expect(result.result.value).toBe('5');
        expect(result.loops).toBe(0);
    });

    it('keeps unused deferred expressions unevaluated', () => {
        const result = compare(`Total = 0
for I in 1 to 3
 Unused' = 1 // 0
 Total += I
end
Total`);
        expect(result.result.value).toBe('6');
        expect(result.loops).toBe(0);
    });
});
