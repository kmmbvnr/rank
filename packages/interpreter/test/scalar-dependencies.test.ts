import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, isNativeFunction, isRankSequence, type InterpreterOptions } from '../src/index.js';
import { scalarFunctionResult } from '../src/scalar-function-proof.js';
import { parse } from '../src/index.js';
import { withInterrupt } from '../src/interrupt.js';

const helpers = `use sequences
fun P compatible Q
  PQ = P concat Q
  if PQ not in primes
    return false
  end
  QP = Q concat P
  return QP in primes
end
fun A concat B
  Scale = 10
  for Scale at most B
    Scale *= 10
  end
  return A * Scale + B
end`;

function outcome(source: string, options: InterpreterOptions = {}) {
    let calls = 0, loops = 0;
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), { ...options,
        onScalarFunctionExecuted: () => calls++, onIntegerLoopExecuted: () => loops++ });
    try {
        try { return { value: formatValue(runtime.execute(source)!), calls, loops, output }; }
        catch (error) { return { error: error instanceof RankError ? error.format() : String(error), calls, loops, output }; }
    } finally { runtime.dispose(); }
}
function compare(source: string, options: InterpreterOptions = {}) {
    const reference = outcome(source, { ...options, compilation: false });
    const compiled = outcome(source, options);
    expect({ ...compiled, calls: 0, loops: 0 }).toEqual({ ...reference, calls: 0, loops: 0 });
    return compiled;
}

describe('guarded nested scalar calls', () => {
    it('compiles the unchanged prime-pair helper with later callee declarations', () => {
        const result = compare(helpers + '\n3 compatible 7');
        expect(result.value).toBe('true');
        expect(result.calls).toBe(3);
        expect(result.loops).toBe(0);
        expect(compare(helpers + '\n13 compatible 7').value).toBe('false');
        expect(outcome(helpers + '\n3 compatible 7', { scalarCallCompilation: false }).calls).toBe(2);
        expect(outcome(helpers + '\n3 compatible 7', { sequenceMembershipCompilation: false }).calls).toBe(2);
    });

    it('links the same helper inside an integer loop', () => {
        const result = compare(helpers + `
Total = 0
for Q in 3 to 20
  if 3 compatible Q
    Total += 1
  end
end
Total`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
        expect(result.calls).toBeGreaterThan(18);
    });

    it.each([1, 2, 3])('preserves tail depth and errors with budget %s', maxCallDepth => {
        for (const tail of [true, false]) for (const x of [0, 2]) {
            compare(`fun X leaf
  return 10 // X
end
fun X middle
  return ${tail ? '(X leaf)' : '(X leaf) + 1'}
end
fun X outer
  return X middle
end
${x} outer`, { maxCallDepth });
        }
    });

    it('retains the scalar tail-call option', () => {
        compare('fun X leaf\n return X + 1\nend\nfun X wrapper\n return X leaf\nend\n2 wrapper',
            { maxCallDepth: 1, compiledScalarTailCalls: false });
    });

    it('handles primitive specialization with distinct parameters', () => {
        for (const [argument, expected] of [['3', '6'], ['1.5', '3'], ['"x"', 'xx']]) {
            const result = compare(`fun A leaf B
 return A + B
end
fun A wrapper
 Value = A leaf A
 return Value
end
${argument} wrapper`);
            expect(result.value).toBe(expected);
            expect(result.calls).toBe(2);
        }
    });

    it('keeps recursion and effectful callees on the ordinary path', () => {
        const recursive = `fun N helper
 if N equal 0
  return 0
 end
 return (N - 1) helper
end`;
        const statement = parse(recursive).statements[0];
        expect(scalarFunctionResult(statement as Parameters<typeof scalarFunctionResult>[0], true, undefined, true)).toBeUndefined();
        expect(compare(recursive + '\n100 helper', { maxCallDepth: 1 }).value).toBe('0');
        expect(compare('use io\nfun X noisy\n X print\n return X\nend\nfun X wrapper\n return X noisy\nend\n3 wrapper')).toMatchObject({ value: '3', output: ['3'], calls: 0 });
    });

    it('keeps memo hits outside the nested kernels and rejects duplicate parameters before execution', () => {
        const result = compare(`fun X leaf
 return X + 1
end
memo X wrapper
 Value = X leaf
 return Value * 2
end
array (3 wrapper) (3 wrapper)`);
        expect(result).toMatchObject({ value: '8 8', calls: 2 });
        expect(compare('fun A leaf A\n return A\nend\nfun X wrapper\n return 1 leaf X\nend\n1.5 wrapper'))
            .toMatchObject({ error: expect.stringContaining('Duplicate function parameter A'), calls: 0 });
    });

    it('bounds long and cyclic call graphs without poisoning shallow helpers', () => {
        const source = Array.from({ length: 20 }, (_, i) => `fun X helper${i}\n return ${i === 19 ? 'X + 1' : `X helper${i + 1}`}\nend`).join('\n');
        const statements = parse(source).statements as Parameters<typeof scalarFunctionResult>[0][];
        expect(scalarFunctionResult(statements[0], true, undefined, true)).toBeUndefined();
        expect(scalarFunctionResult(statements[18], true, undefined, true)).toBeDefined();
        expect(compare(source + '\n3 helper0', { maxCallDepth: 1 }).value).toBe('4');
        const cycle = parse('fun X first\n return X second\nend\nfun X second\n return X first\nend').statements as Parameters<typeof scalarFunctionResult>[0][];
        expect(scalarFunctionResult(cycle[0], true, undefined, true)).toBeUndefined();
        expect(scalarFunctionResult(cycle[1], true, undefined, true)).toBeUndefined();
    });

    it('keeps imported helper ownership and error stacks', () => {
        const loadModule = () => ({ id: 'helpers.ra', source: 'fun X leaf\n return 10 // X\nend' });
        for (const x of [0, 2]) {
            const result = compare(`use "helpers"
fun X wrapper
 return (X leaf) + 1
end
${x} wrapper`, { loadModule, maxCallDepth: 1 });
            if (x) expect(result).toMatchObject({ value: '6', calls: 2 });
        }
    });

    it('retains callback and optional-word argument checks', () => {
        compare('fun X leaf op\n return X\nend\nfun X wrapper Y\n return X leaf Y\nend\n3 wrapper 4');
        expect(compare('fun X scale .by Factor=2\n return X * Factor\nend\nfun X wrapper\n return X scale\nend\n3 wrapper').value).toBe('6');
    });

    it('rechecks replacement functions and recovers when restored', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('fun X leaf\n return X + 1\nend\nfun X wrapper\n return (X leaf) + 1\nend');
            const original = runtime.variables.get('leaf')!;
            expect(runtime.execute('3 wrapper')).toBe(5n);
            runtime.execute('fun X replacement\n return "changed"\nend');
            runtime.variables.set('leaf', runtime.variables.get('replacement')!);
            expect(() => runtime.execute('3 wrapper')).toThrow();
            runtime.variables.set('leaf', original);
            expect(runtime.execute('3 wrapper')).toBe(5n);
        } finally { runtime.dispose(); }
    });
});

describe('trusted sequence membership', () => {
    it.each(['in', 'not in'])('compiles positive and negated membership: %s', operator => {
        const source = `use sequences\nAllowed = primes from 5 till 20\nfun X helper\n return X ${operator} Allowed\nend\narray (3 helper) (5 helper) (17 helper) (20 helper)`;
        expect(compare(source).calls).toBe(4);
    });

    it.each(['in', 'not in'])('compiles membership in integer loops: %s', operator => {
        const source = `use sequences\nAllowed = primes from 5 till 20\nCount = 0\nfor I in 0 till 25\n if I ${operator} Allowed\n  Count += 1\n end\nend\nCount`;
        expect(compare(source).loops).toBe(1);
        expect(outcome(source, { sequenceMembershipCompilation: false }).loops).toBe(0);
    });

    it('rebinds bounded plans and rejects forged or replaced contains methods', () => {
        let calls = 0, hostCalls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute('use sequences');
            // Keep a native source in this host guard test: a language plan
            // would construct a new sequence on each demand.
            runtime.variables.set('Allowed', runtime.execute('primes till 10')!);
            runtime.execute('fun X helper\n return X in Allowed\nend');
            expect(runtime.execute('7 helper')).toBe(true);
            expect(calls).toBe(1);
            runtime.variables.set('Allowed', runtime.execute('primes from 11 till 20')!);
            expect(runtime.execute('7 helper')).toBe(false);
            expect(calls).toBe(2);
            const allowed = runtime.variables.get('Allowed')!;
            if (!isRankSequence(allowed)) throw new Error('missing sequence');
            const contains = allowed.plan.contains!;
            allowed.plan.contains = () => { hostCalls++; return true; };
            expect(runtime.execute('7 helper')).toBe(true);
            expect(calls).toBe(2);
            expect(hostCalls).toBe(1);
            allowed.plan.contains = contains;
            expect(runtime.execute('7 helper')).toBe(false);
            expect(calls).toBe(3);
            runtime.variables.set('Allowed', { kind: 'sequence', plan: { ...allowed.plan,
                contains: () => { hostCalls++; return true; } } });
            expect(runtime.execute('7 helper')).toBe(true);
            expect(calls).toBe(3);
            expect(hostCalls).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('keeps bounded membership captures independent across outer invocations', () => {
        const result = compare(`use sequences
fun Limit outer
 Allowed = primes till Limit
 fun X helper
  return X in Allowed
 end
 Value = 7 helper
 return Value
end
array (5 outer) (10 outer) (5 outer)`);
        expect(result.value).toBe('false true false');
        expect(result.calls).toBe(3);
    });

    it('rechecks sequence capabilities before a cached integer loop', () => {
        let loops = 0, hostCalls = 0;
        const runtime = new Interpreter(undefined, { scalarEntryCompilation: false,
            onIntegerLoopExecuted: () => loops++ });
        try {
            runtime.execute('use sequences');
            runtime.variables.set('Allowed', runtime.execute('primes till 10')!);
            runtime.execute(`fun work
 Count = 0
 for I in 1 to 10
  if I in Allowed
   Count += 1
  end
 end
 return Count
end`);
            expect(runtime.execute('work')).toBe(4n);
            expect(loops).toBe(1);
            const allowed = runtime.variables.get('Allowed')!;
            if (!isRankSequence(allowed)) throw new Error('missing sequence');
            allowed.plan.contains = () => { hostCalls++; return true; };
            expect(runtime.execute('work')).toBe(10n);
            expect(loops).toBe(1);
            expect(hostCalls).toBe(10);
        } finally { runtime.dispose(); }
    });

    it('preserves real membership, missing modules and local shadows', () => {
        compare('use sequences\nfun X helper\n return X in primes\nend\narray (7.0 helper) (7.5 helper)');
        compare('fun X helper\n return X in primes\nend\n7 helper');
        compare('use sequences\nfun X helper\n Result = X in Allowed\n Allowed = primes\n return Result\nend\n7 helper');
        compare('use sequences\nAllowed = primes\nfun X helper\n if X greater 0\n  Result = X in Allowed\n  Allowed = primes till 10\n  return Result\n end\n return false\nend\n7 helper');
    });

    it('retains inspection fallback and observes host cancellation', () => {
        let calls = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(helpers);
            const fn = runtime.variables.get('compatible');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing compatible');
            const signal = new Int32Array(new SharedArrayBuffer(12));
            expect(withInterrupt(signal, () => fn.call([3n, 7n]), () => {})).toBe(true);
            expect(calls).toBe(0);
            expect(fn.call([3n, 7n])).toBe(true);
            expect(calls).toBe(3);
            Atomics.store(signal, 0, 1);
            expect(() => withInterrupt(signal, () => { for (let i = 0; i < 10000; i++) fn.call([3n, 7n]); })).toThrow('Interrupted');
            expect(fn.call([3n, 7n])).toBe(true);
        } finally { runtime.dispose(); }
    });
});
