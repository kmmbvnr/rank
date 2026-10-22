import { describe, expect, it } from 'vitest';
import { Interpreter, isRankPlan, formatValue, parse } from '../src/index.js';
import { sequence } from '../src/sequence.js';
import { completed } from '../src/execution.js';

function counted() {
    let reads = 0;
    return { reads: () => reads, value: sequence({ name: 'composition source', size: { kind: 'exact', value: 4n },
        *iterate() { for (let value = 1n; value <= 4n; value++) { reads++; yield value; } },
    }) };
}

describe.each([false, true])('compositional plan construction (compilation=%s)', compilation => {
    it.each([
        ['Matrix transpose pass', '1 3 2 4'],
        ['Matrix transpose 2 scale', '2 6 4 8'],
        ['Matrix transpose reverse pass', '2 4 1 3'],
        ['Input sum pass', '10'],
        ['Input sum 2 scale', '20'],
        ['Matrix sum 2 scale', '20'],
        ['Input sum abs 2 scale', '20'],
    ])('passes a complete postfix argument recipe to a deferred parameter: %s', (expression, expected) => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute(`use sequences\nuse numbers\nuse io
fun X' pass
 "entered" print
 return X
end
fun X' Factor scale
 "entered" print
 return X * Factor
end
Matrix' = (Input array) reshape 2 2
Result' = ${expression}`);
            expect(output).toEqual(['entered']);
            expect(source.reads()).toBe(0);
            expect(formatValue(runtime.execute('Result')!)).toBe(expected);
            expect(formatValue(runtime.execute('Result')!)).toBe(expected);
            expect(source.reads()).toBe(8);
            expect(output).toEqual(['entered']);
        } finally { runtime.dispose(); }
    });

    it('completes a postfix argument once at an ordinary parameter', () => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute(`use sequences\nuse io
fun X stats
 "entered" print
 return (X sum) + (X len)
end
Matrix' = (Input array) reshape 2 2
Result' = Matrix transpose stats`);
            expect(output).toEqual(['entered']);
            expect(source.reads()).toBe(4);
            expect(runtime.execute('Result')).toBe(12n);
            expect(runtime.execute('Result')).toBe(12n);
            expect(source.reads()).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('preserves Fenwick prefix query arguments before whole calls', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use algo
fun X' pass = X
fun X' Y plusvalue = X + Y
Tree = 3 fenwick
Tree 0 = 2
Tree 1 = 5`);
            expect(runtime.execute('Tree sum 1 pass')).toBe(7n);
            expect(runtime.execute('Tree sum 1 10 plusvalue')).toBe(17n);
            expect(() => runtime.execute('Tree sum plusvalue')).toThrowError('fenwick sum expects one integer index');
        } finally { runtime.dispose(); }
    });

    it('keeps a Fenwick query and its right-hand index deferred in a multi-argument call', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(`use algo\nuse io
fun X' Y plusvalue
 "entered" print
 return X + Y
end
Tree' = 3 fenwick
Result' = Tree sum (1 print) 10 plusvalue`);
            expect(output).toEqual(['entered']);
            expect(runtime.execute('Result')).toBe(10n);
            expect(runtime.execute('Result')).toBe(10n);
            expect(output).toEqual(['entered', '1', '1']);
        } finally { runtime.dispose(); }
    });

    it('executes a user-defined Fenwick index producer at the call, once', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(`use algo\nuse io
fun query_index
 "index" print
 return 1
end
fun X' Y plusvalue
 "entered" print
 return X + Y
end
Tree' = 3 fenwick
Result' = Tree sum query_index 10 plusvalue`);
            expect(output).toEqual(['index', 'entered']);
            expect(runtime.execute('Result')).toBe(10n);
            expect(runtime.execute('Result')).toBe(10n);
            expect(output).toEqual(['index', 'entered']);
        } finally { runtime.dispose(); }
    });

    it('stages a receiver-producing call once before grouping a reduction argument', () => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute(`use sequences\nuse io
fun N produce
 "producer" print
 return Input
end
fun X' Factor scale
 "entered" print
 return X * Factor
end
Result' = (0 produce) sum 2 scale`);
            expect(output).toEqual(['producer', 'entered']);
            expect(source.reads()).toBe(0);
            expect(runtime.execute('Result')).toBe(20n);
            expect(runtime.execute('Result')).toBe(20n);
            expect(source.reads()).toBe(8);
            expect(output).toEqual(['producer', 'entered']);
        } finally { runtime.dispose(); }
    });

    it.each(['Holder .tree', 'Later'])('dispatches a Fenwick query from a field receiver: %s', receiver => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use algo
fun X' Y plusvalue = X + Y
Tree = 3 fenwick
Tree 0 = 2
Tree 1 = 5
Holder = record
 .tree = Tree
end
Later' = Holder .tree
Result' = ${receiver} sum 1 10 plusvalue`);
            expect(runtime.execute('Result')).toBe(17n);
            expect(runtime.execute('Result')).toBe(17n);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['Unknown sum 2 scale', [], 1],
        ['(Unknown sum) 2 scale', [], 0],
        ['Unknown sum 2 scale', ['sequence', 'array'], 0],
    ] as const)('demands an unknown receiver kind only when grouping needs it: %s %s', (expression, types, entryDemands) => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        let demands = 0;
        runtime.variables.set('Unknown', { kind: 'plan', dependencies: new Map(), result: { types },
            evaluate() { demands++; return completed(source.value); },
        });
        try {
            runtime.execute(`use sequences
fun X' Factor scale = X * Factor
Result' = ${expression}`);
            expect(demands).toBe(entryDemands);
            expect(source.reads()).toBe(0);
            expect(runtime.execute('Result')).toBe(20n);
            expect(runtime.execute('Result')).toBe(20n);
            expect(demands).toBe(entryDemands + 2);
            expect(source.reads()).toBe(8);
        } finally { runtime.dispose(); }
    });

    it('retries failed receiver dispatch without retaining its construction scope', () => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        let demands = 0;
        runtime.variables.set('Unknown', { kind: 'plan', dependencies: new Map(),
            evaluate() {
                if (++demands === 1) throw new Error('receiver dispatch failed');
                return completed(source.value);
            },
        });
        try {
            runtime.execute(`use sequences\nuse io
fun X' Factor scale
 "entered" print
 return X * Factor
end`);
            const program = parse("Result' = Unknown sum 2 scale");
            expect(() => runtime.executeProgram(program)).toThrowError('receiver dispatch failed');
            expect(output).toEqual([]);
            runtime.executeProgram(program);
            expect(output).toEqual(['entered']);
            expect(source.reads()).toBe(0);
            expect(runtime.execute('Result')).toBe(20n);
            expect(runtime.execute('Result')).toBe(20n);
            expect(demands).toBe(4);
            expect(source.reads()).toBe(8);
            expect(output).toEqual(['entered']);
        } finally { runtime.dispose(); }
    });

    it('demands a planned receiver for ungrouped argument addressing', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute("use sequences\nfun Value Limit above = Value greater Limit\nM' = (array 1 2 3 4) reshape 2 2");
            expect(runtime.execute('M 1 0 2 above')).toBe(true);
            expect(runtime.execute('Result = M 1 0 3 above')).toBe(false);
            runtime.execute("Result' = M 1 0 2 above");
            expect(runtime.execute('Result')).toBe(true);
            runtime.execute("fun Value X' keep = Value\nLater' = Input sum");
            expect(runtime.execute('M 1 0 Later keep')).toBe(3n);
            expect(source.reads()).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each(['', 'Result = ', "Result' = "])('keeps ordinary arity diagnostics while staging a call: %s', prefix => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute('use io\nfun A B add\n "entered" print\n return A + B\nend');
            expect(() => runtime.execute(`${prefix}1 2 3 add`)).toThrowError('add expects 2 arguments, got 3');
            expect(() => runtime.execute(`${prefix}1 add`)).toThrowError('add expects 2 arguments, got 1');
            runtime.execute('fun X only\n "entered" print\n return X\nend');
            expect(() => runtime.execute(`${prefix}1 2 only`)).toThrowError('only expects 1 arguments, got 2');
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it.each(['(Input transform) sum', 'Input transform sum', '(Input transform) sum + 1'])(
        'executes the helper and defers surrounding work: %s', expression => {
            const source = counted();
            const output: string[] = [];
            const runtime = new Interpreter(text => output.push(text), { compilation });
            runtime.variables.set('Input', source.value);
            try {
                runtime.execute(`use io\nfun X' transform\n "entered" print\n return X * 2\nend\nResult' = ${expression}`);
                expect(output).toEqual(['entered']);
                expect(source.reads()).toBe(0);
                expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
                const expected = expression.endsWith('+ 1') ? 21n : 20n;
                expect(runtime.execute('Result')).toBe(expected);
                expect(runtime.execute('Result')).toBe(expected);
                expect(source.reads()).toBe(8);
                expect(output).toEqual(['entered']);
            } finally { runtime.dispose(); }
        },
    );

    it('keeps a predicate reference deferred until data consumption', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute("fun X above = X greater 2\nResult' = Input filter above sum");
            expect(source.reads()).toBe(0);
            expect(runtime.execute('Result')).toBe(7n);
            expect(runtime.execute('Result')).toBe(7n);
            expect(source.reads()).toBe(8);
        } finally { runtime.dispose(); }
    });

    it('stages named and right-parameter calls without forcing their surrounding expression', () => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute(`use io
fun X' transform Scale .offset Offset = 1
 "entered" print
 return X * Scale + Offset
end
Result' = (Input transform 2 offset 3) sum + 1`);
            expect(output).toEqual(['entered']);
            expect(source.reads()).toBe(0);
            expect(runtime.execute('Result')).toBe(33n);
            expect(runtime.execute('Result')).toBe(33n);
            expect(source.reads()).toBe(8);
            expect(output).toEqual(['entered']);
        } finally { runtime.dispose(); }
    });

    it('stages a nullary producer before a deferred reduction', () => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute(`use io\nfun make\n "entered" print\n return Input * 2\nend\nResult' = make sum`);
            expect(output).toEqual(['entered']);
            expect(source.reads()).toBe(0);
            expect(runtime.execute('Result')).toBe(20n);
            expect(runtime.execute('Result')).toBe(20n);
            expect(source.reads()).toBe(8);
            expect(output).toEqual(['entered']);
        } finally { runtime.dispose(); }
    });

    it('stages independent calls in source order without changing the parsed program', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            const program = parse(`use io
fun X mark
 X print
 return X
end
Result' = (1 mark) + (2 mark)`);
            const original = program.statements.at(-1);
            runtime.executeProgram(program);
            expect(output).toEqual(['1', '2']);
            expect(runtime.execute('Result')).toBe(3n);
            expect(runtime.execute('Result')).toBe(3n);
            expect(output).toEqual(['1', '2']);
            expect(program.statements.at(-1)).toBe(original);
            runtime.executeProgram(program);
            expect(runtime.execute('Result')).toBe(3n);
            expect(output).toEqual(['1', '2', '1', '2']);
        } finally { runtime.dispose(); }
    });

    it.each(['false and chosen', 'true or chosen', '7 default chosen'])(
        'keeps an unselected call unexecuted: %s', expression => {
            const output: string[] = [];
            const runtime = new Interpreter(text => output.push(text), { compilation });
            try {
                runtime.execute(`use io\nfun chosen\n "chosen" print\n return true\nend\nResult' = ${expression}`);
                expect(output).toEqual([]);
                runtime.execute('Result');
                expect(output).toEqual([]);
            } finally { runtime.dispose(); }
        },
    );

    it('selects a call only when its deferred condition is demanded', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(`use io
Flag' = 2 greater 1
fun chosen
 "chosen" print
 return true
end
Result' = Flag and chosen`);
            expect(output).toEqual([]);
            expect(runtime.execute('Result')).toBe(true);
            expect(runtime.execute('Result')).toBe(true);
            expect(output).toEqual(['chosen', 'chosen']);
        } finally { runtime.dispose(); }
    });

    it('does not run a fallback for an array that has no missing cells', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(`use io
Values = array 1 2
fun fallback
 "fallback" print
 return 9
end
Result' = Values default fallback`);
            expect(output).toEqual([]);
            expect(formatValue(runtime.execute('Result')!)).toBe('1 2');
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it('keeps a deferred local scalar error out of immediate function work', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("fun X delayed\n Bad' = X // 0\n return Bad\nend\nResult' = 1 delayed");
            expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
            expect(() => runtime.execute('Result')).toThrowError('division by zero');
        } finally { runtime.dispose(); }
    });


    it('keeps deferred loop locals out of register execution', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(runtime.execute("for I in 1 to 2\n Bad' = I // 0\nend\n7")).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it('keeps a deferred array expression out of eager tensor publication', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("A = array 1 2\nBad' = (A + 1) // 0");
            expect(isRankPlan(runtime.variables.get('Bad')!)).toBe(true);
            expect(() => runtime.execute('Saved = Bad')).toThrowError('division by zero');
        } finally { runtime.dispose(); }
    });


    it.each(['Matrix rowsum rank 1', 'Matrix intrinsic'])(
        'keeps ranked callbacks deferred and demands their returned scalar plans: %s', expression => {
            let reads = 0;
            const runtime = new Interpreter(undefined, { compilation });
            runtime.variables.set('Matrix', { kind: 'array', shape: [2, 2], items: [],
                itemAt: index => { reads++; return BigInt(index + 1); },
            });
            try {
                runtime.execute(`fun Row' rowsum = Row sum\nfun Row' intrinsic rank 1 = Row sum\nResult' = ${expression}`);
                expect(reads).toBe(0);
                expect(formatValue(runtime.execute('Saved = Result')!)).toBe('3 7');
                const firstDemand = reads;
                expect(firstDemand).toBeGreaterThanOrEqual(4);
                expect(formatValue(runtime.execute('Saved')!)).toBe('3 7');
                expect(reads).toBe(firstDemand);
                expect(formatValue(runtime.execute('Again = Result')!)).toBe('3 7');
                expect(reads).toBe(firstDemand * 2);
            } finally { runtime.dispose(); }
        },
    );

});
