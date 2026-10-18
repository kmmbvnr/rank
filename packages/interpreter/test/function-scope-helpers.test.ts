import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

for (const compilation of [false, true]) describe(`function scope helpers (compiled=${compilation})`, () => {
    const create = (source: string) => new Interpreter(undefined, { compilation,
        loadModule: () => ({ id: 'helpers.ra', source }) });

    it.each(['', 'as H'])('rejects retaining a nested callback through an import %s', alias => {
        const runtime = create('use algo\nfun Items save callback\n Items push callback\n return 0\nend');
        try {
            expect(() => runtime.execute(`use algo
use "helpers" ${alias}
fun Limit outer
 Items = new queue
 fun X below = X less Limit
 Items ${alias ? 'H.save' : 'save'} below
 return Items
end
6 outer`)).toThrow('nested function below cannot be returned, assigned, or stored');
        } finally { runtime.dispose(); }
    });

    it('permits a nested callback through a synchronous imported helper', () => {
        const runtime = create('fun X check predicate = X predicate');
        try {
            expect(runtime.execute(`use "helpers" as H
fun Limit outer
 fun X below = X less Limit
 return 4 H.check below
end
6 outer`)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('checks callback retention through a helper from an earlier notebook cell', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use algo\nfun Items save callback\n Items push callback\n return 0\nend');
            expect(() => runtime.execute(`fun Limit outer
 Items = new queue
 fun X below = X less Limit
 Items save below
 return Items
end
6 outer`)).toThrow('nested function below cannot be returned, assigned, or stored');
        } finally { runtime.dispose(); }
    });

    it('permits memo to call a parameter-only imported helper', () => {
        const runtime = create('fun X increment = X + 1');
        try {
            expect(runtime.execute('use "helpers" as H\nmemo X cached = X H.increment\n3 cached')).toBe(4n);
        } finally { runtime.dispose(); }
    });

    it('snapshots a qualified imported helper together with local data', () => {
        const runtime = create('fun X increment = X + 1');
        try {
            runtime.execute(`use sequences
use "helpers" as H
Limit = 4
fun X below = X H.increment less Limit
S = 1 to 5 filter below
Limit = 2`);
            expect(runtime.execute('S sum')).toBe(3n);
        } finally { runtime.dispose(); }
    });

    it('retains imported helper proofs in later notebook cells', () => {
        const runtime = create('fun X increment = X + 1');
        try {
            runtime.execute('use "helpers" as H');
            expect(runtime.execute('memo X cached = X H.increment\n3 cached')).toBe(4n);
        } finally { runtime.dispose(); }
    });

    it('rejects mutable function aliases as memo dependencies', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute('fun X increment = X + 1\nalias_fn = increment\nmemo X cached = X alias_fn'))
                .toThrow('memo cached depends on external data alias_fn');
            runtime.execute('fun X increment = X + 1\nalias_fn = increment');
            expect(() => runtime.execute('memo X cached = X alias_fn'))
                .toThrow('memo cached depends on external data alias_fn');
        } finally { runtime.dispose(); }
    });

    it('rejects handing a nested callback to an opaque host function', () => {
        const runtime = new Interpreter(undefined, { compilation });
        let called = false;
        runtime.variables.set('retain', { kind: 'function', name: 'retain', arities: [1], monadicRank: 'all',
            call: () => { called = true; return 0n; } });
        try {
            expect(() => runtime.execute(`fun Limit outer
 fun X below = X less Limit
 below retain
 return 0
end
6 outer`)).toThrow('nested function below cannot be returned, assigned, or stored');
            expect(called).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('rejects transitive module data in an imported memo dependency', () => {
        const runtime = create('fun X increment = X + Offset');
        try {
            expect(() => runtime.execute('use "helpers" as H\nOffset = 1\nmemo X cached = X H.increment\n3 cached'))
                .toThrow('memo cached depends on external data Offset');
        } finally { runtime.dispose(); }
    });

    it.each(['Items mutate', 'Items invoke mutate'])('rejects captured state passed to an opaque host through %s', expression => {
        const runtime = new Interpreter(undefined, { compilation });
        let called = false;
        runtime.variables.set('mutate', { kind: 'function', name: 'mutate', arities: [1], monadicRank: 'all',
            call: () => { called = true; return 0n; } });
        try {
            expect(() => runtime.execute(`use algo
Items = new queue
fun Value invoke callback = Value callback
fun perform = ${expression}
perform`)).toThrow('Items is read-only in perform');
            expect(called).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('rejects a mutating callback forwarded through an ordinary helper', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute(`use algo
Items = new queue
fun Items invoke mutate = Items mutate
fun Items append
 Items push 1
 return 0
end
fun perform = Items invoke append
perform`)).toThrow('Items is read-only in perform');
        } finally { runtime.dispose(); }
    });

    it('keeps callback effects specific to each call', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute(`use algo
Items = new queue
fun Items invoke action = Items action
fun Items append
 Items push 1
 return 0
end
fun Items length = Items len
fun inspect = Items invoke length
Scratch = new queue
Scratch invoke append
inspect`)).toBe(0n);
        } finally { runtime.dispose(); }
    });

    it('rejects mutation through a builtin callback', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute(`use algo
Q = new queue
Q push 1
fun Items invoke action = Items action
fun consume = Q invoke pop
consume`)).toThrow('Q is read-only in consume');
        } finally { runtime.dispose(); }
    });

    it('rejects returning a container holding a nested callback pipeline stored by a helper', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute(`use algo
use sequences
fun Items S store
 Items push S
 return 0
end
fun Limit outer
 Items = new queue
 fun X below = X less Limit
 S = 1 to 10 filter below
 Items S store
 return Items
end
6 outer`)).toThrow('lazy result retains nested function below');
        } finally { runtime.dispose(); }
    });

    it('permits storing and returning materialized callback results', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute(`use algo
use sequences
fun Items S store
 Items push S
 return 0
end
fun Limit outer
 Items = new queue
 fun X below = X less Limit
 S = 1 to 10 filter below
 Items (S array) store
 return Items
end
6 outer len`)).toBe(1n);
        } finally { runtime.dispose(); }
    });
});
