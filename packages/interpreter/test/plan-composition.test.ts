import { describe, expect, it } from 'vitest';
import { Interpreter, isRankPlan, formatValue, parse } from '../src/index.js';
import { sequence } from '../src/sequence.js';

function counted() {
    let reads = 0;
    return { reads: () => reads, value: sequence({ name: 'composition source', size: { kind: 'exact', value: 4n },
        *iterate() { for (let value = 1n; value <= 4n; value++) { reads++; yield value; } },
    }) };
}

describe.each([false, true])('compositional plan construction (compilation=%s)', compilation => {
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
