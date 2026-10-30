import { expect, it, vi } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { detachInspection, withInterrupt } from '../src/interrupt.js';

const program = `Total = 0
for I in 1 to 100
  Total += I
end
Total`;
const signal = () => new Int32Array(new SharedArrayBuffer(12));

it.each([true, false])('reuses readonly capabilities, compilation=%s', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        const capabilities = runtime.compiler;
        expect(runtime.execute(program)).toBe(5050n);
        expect(runtime.compiler).toBe(capabilities);
        expect(capabilities.enabled).toBe(compilation);
        for (const value of [capabilities, capabilities.loops, capabilities.tensors,
            capabilities.scalars, capabilities.functions, capabilities.blocks, capabilities.hooks]) {
            expect(Object.isFrozen(value)).toBe(true);
        }
        expect(() => Object.assign(capabilities.loops, { number: !compilation })).toThrow(TypeError);
    } finally { runtime.dispose(); }
});

it('reads configuration getters once at creation, not at every execution step', () => {
    let reads = 0;
    const runtime = new Interpreter(() => {}, {
        compiler: { blocks: { get blocks() { reads++; return false; } } },
    });
    try {
        const captured = reads;
        expect(captured).toBeGreaterThan(0);
        expect(runtime.execute(program)).toBe(5050n);
        expect(runtime.execute('Total += 1\nTotal')).toBe(5051n);
        expect(reads).toBe(captured);
    } finally { runtime.dispose(); }
});

it('snapshots flat/grouped options and hook identities, retaining live callback state', () => {
    let calls = 0;
    const replacement = vi.fn();
    const loops = { number: false };
    const hooks = { onIntegerLoopExecuted: () => { calls++; } };
    const compiler = { loops, hooks };
    const options = { numberLoopCompilation: true, compiler };
    const runtime = new Interpreter(() => {}, options);
    try {
        loops.number = true;
        hooks.onIntegerLoopExecuted = replacement;
        options.numberLoopCompilation = false;
        compiler.loops = { number: false };
        expect(runtime.compiler.loops.number).toBe(true); // Flat flag wins.
        expect(runtime.options.compiler?.loops?.number).toBe(false);
        expect(runtime.execute(program)).toBe(5050n);
        expect(calls).toBeGreaterThan(0);
        expect(replacement).not.toHaveBeenCalled();
        calls = 0;
        expect(runtime.execute(program)).toBe(5050n);
        expect(calls).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
});

it('children and test blocks inherit the captured configuration and hooks', () => {
    const original = vi.fn(), replacement = vi.fn();
    const hooks = { onIntegerLoopExecuted: original };
    const options: InterpreterOptions = {
        compiler: { hooks },
        loadModule: () => ({ id: 'worker', source: program }),
    };
    const runtime = new Interpreter(() => {}, options);
    try {
        hooks.onIntegerLoopExecuted = replacement;
        runtime.execute('use "worker"\nrun');
        expect(original).toHaveBeenCalled();
        original.mockClear();
        runtime.execute(`use testing
test "child"
  use "worker"
  run
  Total equal 5050
end`);
        expect(runtime.testResults.at(-1)?.passed).toBe(true);
        expect(original).toHaveBeenCalled();
        expect(replacement).not.toHaveBeenCalled();
    } finally { runtime.dispose(); }
});

it('selects reference capabilities while inspecting, then restores the compiled snapshot', () => {
    const compiled = vi.fn();
    const runtime = withInterrupt(signal(), () => new Interpreter(() => {}, {
        onIntegerLoopExecuted: compiled,
    }), () => {});
    try {
        const base = runtime.compiler;
        expect(base.enabled).toBe(true);
        expect(runtime.execute(program)).toBe(5050n);
        expect(compiled).toHaveBeenCalled();
        compiled.mockClear();
        withInterrupt(signal(), () => {
            const reference = runtime.compiler;
            expect(reference.enabled).toBe(false);
            expect(runtime.compiler).toBe(reference);
            expect(runtime.execute(program)).toBe(5050n);
            expect(compiled).not.toHaveBeenCalled();
            withInterrupt(signal(), () => expect(runtime.compiler).toBe(base));
            expect(runtime.compiler).toBe(reference);
            detachInspection();
            expect(runtime.compiler).toBe(base);
        }, () => {});
        expect(runtime.compiler).toBe(base);
        expect(runtime.execute(program)).toBe(5050n);
        expect(compiled).toHaveBeenCalled();
    } finally { runtime.dispose(); }
});

it('restores the capability selection when an inspected execution throws', () => {
    const runtime = new Interpreter(() => {});
    try {
        const base = runtime.compiler;
        expect(() => withInterrupt(signal(), () => runtime.execute('1 // 0'), () => {})).toThrow();
        expect(runtime.compiler).toBe(base);
        expect(runtime.execute(program)).toBe(5050n);
    } finally { runtime.dispose(); }
});
