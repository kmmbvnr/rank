import { analyzeValues, incompatibleShapes } from '@arrrank/language';
import { expect, it } from 'vitest';
import { Interpreter, isRankArray, parse } from '../src/index.js';
import { derivedArray } from '../src/array-storage.js';
import { completed } from '../src/execution.js';
import { native } from '../src/modules/shared.js';
import { RankApplication } from '../src/rank-application.js';

type Shape = readonly number[];

function array(shape: Shape): string {
    return shape.length ? `array shape ${shape.join(' ')} fill 2` : '2';
}

/** Reference rules from CURRENT_SPEC, independent of the analyzer and runtime helpers. */
function cellAndFrame(shape: Shape, rank: number, axes?: Shape): { cell: Shape; frame: Shape } {
    const cellRank = rank < 0 ? Math.max(0, shape.length + rank) : Math.min(shape.length, rank);
    const frameAxes = axes ? shape.map((_, axis) => axis).filter(axis => !axes.includes(axis)) : Array.from({ length: shape.length - cellRank }, (_, index) => index);
    const selected = new Set(frameAxes);
    return {
        cell: shape.filter((_, index) => !selected.has(index)),
        frame: frameAxes.map(axis => shape[axis]),
    };
}

function broadcast(left: Shape, right: Shape): Shape | undefined {
    const result: number[] = [];
    for (let offset = Math.max(left.length, right.length); offset > 0; offset--) {
        const a = left.at(-offset) ?? 1;
        const b = right.at(-offset) ?? 1;
        if (a !== b && a !== 1 && b !== 1) return;
        result.push(a === 1 ? b : a);
    }
    return result;
}

function check(source: string, expected: Shape): { knownAxes: number; unknownAxes: number; knownRank: boolean } {
    const program = parse(source);
    const facts = analyzeValues(program).bindings.get('R');
    const runtime = new Interpreter();
    try {
        const value = runtime.execute(`${source}\nR`);
        if (value === undefined) throw new Error(`no result for ${source}`);
        const actual = isRankArray(value) ? value.shape : [];
        expect(actual, source).toEqual(expected);
        const provenRank = facts?.rank ?? facts?.shape?.length;
        if (provenRank !== undefined) expect(provenRank, source).toBe(actual.length);
        let knownAxes = 0;
        let unknownAxes = 0;
        for (let axis = 0; axis < actual.length; axis++) {
            const proven = facts?.shape?.[axis];
            if (proven == null) unknownAxes++;
            else { expect(proven, source).toBe(actual[axis]); knownAxes++; }
        }
        return { knownAxes, unknownAxes, knownRank: provenRank !== undefined };
    } finally { runtime.dispose(); }
}

it('agrees on bounded unary cell/frame shapes, including negative ranks and empty frames', () => {
    let cases = 0;
    let knownAxes = 0;
    let knownRanks = 0;
    for (const shape of [[], [0], [1], [2], [0, 2], [1, 2], [2, 1], [2, 2], [0, 1, 2], [2, 1, 2]]) {
        for (const rank of [-3, -1, 0, 1, 2, 4]) {
            const { frame } = cellAndFrame(shape, rank);
            const source = `use numbers\nA = ${array(shape)}\nR = A sum rank ${rank}`;
            const result = check(source, frame);
            knownAxes += result.knownAxes;
            if (result.knownRank) knownRanks++;
            cases++;
        }
    }
    expect(cases).toBe(60);
    expect(knownAxes).toBeGreaterThan(30);
    expect(knownRanks).toBeGreaterThan(20);
});

it('agrees on explicit cell-axis selection for fixed-shape cell results', () => {
    let cases = 0;
    for (const shape of [[0, 2], [1, 2], [2, 2], [0, 1, 2], [2, 1, 2]]) {
        for (const axes of shape.length === 2 ? [[0], [1]] : [[0], [1], [2], [1, 0], [2, 0]]) {
            const rank = axes.length;
            const { frame } = cellAndFrame(shape, rank, axes);
            const source = `use numbers\nA = ${array(shape)}\nR = A sum axis ${axes.join(' ')} rank ${rank}`;
            check(source, frame);
            cases++;
        }
    }
    expect(cases).toBe(16);
});

it('agrees on intrinsic scalar and vector ranks', () => {
    let cases = 0;
    for (const shape of [[], [0], [1], [2], [0, 2], [2, 1], [2, 2], [2, 1, 2]]) {
        check(`use numbers\nA = ${array(shape)}\nR = A abs`, shape);
        cases++;
        if (shape.length) {
            check(`use sequences\nA = ${array(shape)}\nR = A sort`, shape);
            cases++;
        }
    }
    expect(cases).toBe(15);
});

it('agrees on trailing-frame broadcasting and rejects concrete mismatches', () => {
    let valid = 0;
    let invalid = 0;
    let knownRanks = 0;
    for (const [left, right] of [
        [[], [2, 3]], [[1], [2]], [[0], [1]], [[2, 1], [1, 3]], [[2, 3], [1, 3]],
        [[2, 1, 3], [1, 3]], [[0, 2], [1, 2]], [[1, 2], [0, 1]], [[2], [3]], [[2, 0], [2, 2]],
    ] as const) {
        const expected = broadcast(left, right);
        const conflict = incompatibleShapes({ types: ['array'], shape: left }, { types: ['array'], shape: right });
        expect(conflict).toBe(expected === undefined);
        for (const modifier of ['', ' rank 0 0']) {
            const source = `use numbers\nA = ${array(left)}\nB = ${array(right)}\nR = A B gcd${modifier}`;
            if (expected) { if (check(source, expected).knownRank) knownRanks++; valid++; }
            else {
                const runtime = new Interpreter();
                try { expect(() => runtime.execute(`${source}\nR`), source).toThrow(); }
                finally { runtime.dispose(); }
                invalid++;
            }
        }
    }
    expect([valid, invalid]).toEqual([16, 4]);
    expect(knownRanks).toBeGreaterThan(0);
    check(`use numbers\nA = ${array([2])}\nB = ${array([1])}\nR = A B gcd rank -1 -1`, [2]);
});

it('keeps data-dependent result lengths unknown while preserving the frame rank', () => {
    for (const [rows, expected] of [[0, [0, 0]], [2, [2, 1]]] as const) {
        const source = `use sequences\nA = ${array([rows, 2])}\nR = A unique rank 1`;
        const { unknownAxes } = check(source, expected);
        expect(unknownAxes, source).toBeGreaterThan(0);
    }
});

it('gets empty-frame shapes without reading lazy cells or calling the function', () => {
    let reads = 0;
    let calls = 0;
    const input = derivedArray([0, 2], [], () => { reads++; throw new Error('read empty source'); });
    const application = new RankApplication((fn, args) => completed(fn.call(args)), () => {}, new Map(), () => undefined);
    for (const [name, shape] of [['sort', [0, 2]], ['unique', [0, 0]]] as const) {
        const fn = native(name, 1, () => { calls++; throw new Error('called on empty frame'); });
        const result = application.applyUnaryAtRank(input, fn, 1);
        if (!('done' in result) || !isRankArray(result.value)) throw new Error('expected immediate array');
        expect(result.value.shape).toEqual(shape);
    }
    expect([reads, calls]).toEqual([0, 0]);
});

it('preserves documented matrix batches in both execution modes', () => {
    // Independent expectations: do not derive these with runtime shape helpers.
    const cases: [Shape, Shape, Shape, bigint][] = [
        [[8, 2, 3], [8, 3, 4], [8, 2, 4], 6n],
        [[8, 1, 2, 3], [1, 6, 3, 4], [8, 6, 2, 4], 6n],
        [[0, 2, 3], [1, 3, 4], [0, 2, 4], 6n],
        [[1, 1, 2, 3], [1, 1, 3, 4], [1, 1, 2, 4], 6n],
        [[2, 2, 0], [1, 0, 4], [2, 2, 4], 0n],
    ];
    for (const [left, right, expected, element] of cases) {
        for (const call of ['A B matmul rank 2 2', 'A B multiply rank 2 2']) {
            const source = [
                'use linalg',
                'fun X Y multiply',
                '  return X Y matmul',
                'end',
                `A = array shape ${left.join(' ')} fill 1`,
                `B = array shape ${right.join(' ')} fill 2`,
                `R = ${call}`,
            ].join('\n');
            check(source, expected);
            for (const enabled of [false, true]) {
                const runtime = new Interpreter(() => {}, {
                    blockCompilation: enabled, functionBodyCompilation: enabled,
                    scalarFunctionCompilation: enabled, tensorFusion: enabled,
                });
                try {
                    const result = runtime.execute(`${source}\nR`);
                    if (!result || !isRankArray(result)) throw new Error('expected batched array');
                    expect(result.shape, source).toEqual(expected);
                    expect(result.items, source).toEqual(
                        Array(expected.reduce((size, dimension) => size * dimension, 1)).fill(element));
                } finally { runtime.dispose(); }
            }
        }
    }
});

it('aligns operator cells with batch frames and infers empty result cells', () => {
    for (const [left, right, ranks, expected] of [
        [[2], [2, 3, 4], '0 2', [2, 3, 4]],
        [[2, 3, 4], [2], '2 0', [2, 3, 4]],
        [[2, 1], [1, 3, 2, 4], '0 2', [2, 3, 2, 4]],
        [[0], [0, 3, 4], '0 2', [0, 3, 4]],
        [[1], [0, 3, 4], '0 2', [0, 3, 4]],
        [[2], [2, 0, 4], '0 2', [2, 0, 4]],
        [[2], [2, 3, 4], '-1 -1', [2, 3, 4]],
        [[2], [2, 3, 4], '0e0 2e0', [2, 3, 4]],
        [[2], [2], '5 5', [2]],
        [[], [2, 3, 4], '0 2', [2, 3, 4]],
    ] as [Shape, Shape, string, Shape][]) {
        for (const operator of ['+', '-', '*', '/', '//', 'mod', '**']) {
            const source = `A = ${array(left)}\nB = ${array(right)}\nR = A B ${operator} rank ${ranks}`;
            expect(check(source, expected)).toEqual({ knownAxes: expected.length, unknownAxes: 0, knownRank: true });
        }
    }
});

it('evaluates each ranked arithmetic and logical operator in both execution modes', () => {
    const arithmetic: [string, (a: number, b: number) => number][] = [
        ['+', (a, b) => a + b], ['-', (a, b) => a - b], ['*', (a, b) => a * b],
        ['/', (a, b) => a / b], ['//', (a, b) => Math.floor(a / b)],
        ['mod', (a, b) => a - Math.floor(a / b) * b], ['**', (a, b) => a ** b],
    ];
    const evaluate = (body: string, enabled: boolean) => {
        const runtime = new Interpreter(() => {}, {
            blockCompilation: enabled, functionBodyCompilation: enabled,
            scalarFunctionCompilation: enabled, tensorFusion: enabled,
        });
        try {
            const result = runtime.execute(`fun result\n${body}\nend\nresult`);
            if (!result || !isRankArray(result)) throw new Error('expected array');
            return result;
        } finally { runtime.dispose(); }
    };
    for (const enabled of [false, true]) {
        for (const [operator, oracle] of arithmetic) {
            const body = `A = array 2 3\nB = array 1 2 3 4 5 6 7 8 shape 2 2 2\n`
                + `return A B ${operator} rank 0 2`;
            const result = evaluate(body, enabled);
            expect(result.shape).toEqual([2, 2, 2]);
            expect(result.items.map(Number), operator).toEqual(
                Array.from({ length: 8 }, (_, i) => oracle(i < 4 ? 2 : 3, i + 1)));
        }
        for (const operator of ['and', 'or', 'xor']) {
            const source = `A = array true false\nB = array true false false true shape 2 2\n`
                + `R = A B ${operator} rank 0 1`;
            expect(check(source, [2, 2]).knownAxes).toBe(2);
            const result = evaluate(source + '\nreturn R', enabled);
            expect(result.items).toEqual(operator === 'and' ? [true, false, false, false]
                : operator === 'or' ? [true, true, false, true] : [false, true, false, true]);
        }
    }
});

it('rejects incompatible operator frames and cells without changing infix broadcasting', () => {
    for (const [a, b, ranks] of [
        [[2], [3, 2, 4], '0 2'], // frame mismatch
        [[2, 3], [2, 4], '1 1'], // cell mismatch
        [[0, 3], [1, 4], '1 1'], // known cell mismatch even in an empty frame
    ] as [Shape, Shape, string][]) {
        const runtime = new Interpreter();
        try {
            expect(() => runtime.execute(`A = ${array(a)}\nB = ${array(b)}\nA B * rank ${ranks}`))
                .toThrow(/shape mismatch/);
        } finally { runtime.dispose(); }
    }
    const runtime = new Interpreter();
    try {
        const result = runtime.execute('A = array 10 100\nB = array 1 2 3 4 shape 2 2\nA * B');
        if (!result || !isRankArray(result)) throw new Error('expected array');
        expect(result.items).toEqual([10n, 200n, 30n, 400n]);
    } finally { runtime.dispose(); }
});

it('does not evaluate arithmetic in empty frames and keeps text results boxed', () => {
    expect(check('A = array shape 0 fill 0\nB = array shape 1 2 3 fill 0\nR = A B // rank 0 2', [0, 2, 3]))
        .toEqual({ knownAxes: 3, unknownAxes: 0, knownRank: true });
    for (const size of [0, 2]) {
        const runtime = new Interpreter();
        try {
            const result = runtime.execute(`A = array shape ${size} fill "a"\nA "bc" + rank 0 1`);
            if (!result || !isRankArray(result)) throw new Error('expected array');
            expect(result.shape).toEqual([size]);
            expect(result.items).toEqual(Array(size).fill('abc'));
        } finally { runtime.dispose(); }
    }
});

it('evaluates ranked logical operands while preserving scalar infix guards', () => {
    const runtime = new Interpreter();
    try {
        expect(runtime.execute('false and (1 // 0)')).toBe(false);
        expect(runtime.execute('true or (1 // 0)')).toBe(true);
        expect(() => runtime.execute('false (1 // 0) and rank 0 0')).toThrow('division by zero');
        expect(() => runtime.execute('true (1 // 0) or rank 0 0')).toThrow('division by zero');
    } finally { runtime.dispose(); }
});

it('routes broadcast matrix cells in frame order without mixing contraction axes', () => {
    const left = Array.from({ length: 12 }, (_, index) => BigInt(index + 1));
    const right = Array.from({ length: 18 }, (_, index) => BigInt(index + 1));
    const expected: bigint[] = [];
    // Two left matrices crossed with three right matrices; ordinary scalar dot products.
    for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) {
        for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
            let total = 0n;
            for (let k = 0; k < 3; k++) total += left[a * 6 + row * 3 + k] * right[b * 6 + k * 2 + col];
            expected.push(total);
        }
    }
    for (const enabled of [false, true]) {
        const runtime = new Interpreter(() => {}, {
            blockCompilation: enabled, functionBodyCompilation: enabled,
            scalarFunctionCompilation: enabled, tensorFusion: enabled,
        });
        try {
            const source = `use linalg\nA = array ${left.join(' ')} shape 2 1 2 3\n`
                + `B = array ${right.join(' ')} shape 1 3 3 2\nR = A B matmul rank 2 2`;
            check(source, [2, 3, 2, 2]);
            const result = runtime.execute(`${source}\nR`);
            if (!result || !isRankArray(result)) throw new Error('expected batched array');
            expect(result.shape).toEqual([2, 3, 2, 2]);
            expect(result.items).toEqual(expected);
        } finally { runtime.dispose(); }
    }
});


it('agrees on source-axis placement for same-rank callbacks and changed lengths', () => {
    for (const shape of [[2, 3, 4], [2, 0, 4]]) {
        const source = `use sequences\nA = ${array(shape)}\n`;
        check(source + 'R = A reverse axis 0 2', shape);
        check(source + 'R = A sort axis 0', shape);
        check(source + 'fun X ends\n return array (X 0) (X 0) (X 1)\nend\nR = A ends axis 0', [3, shape[1], shape[2]]);
    }
});
