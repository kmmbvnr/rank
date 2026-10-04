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
    const frameAxes = axes ?? Array.from({ length: shape.length - cellRank }, (_, index) => index);
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

it('agrees on explicit frame-axis order for fixed-shape cell results', () => {
    let cases = 0;
    for (const shape of [[0, 2], [1, 2], [2, 2], [0, 1, 2], [2, 1, 2]]) {
        for (const axes of shape.length === 2 ? [[0], [1]] : [[0], [1], [2], [1, 0], [2, 0]]) {
            const rank = shape.length - axes.length;
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
