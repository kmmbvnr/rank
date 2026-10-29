import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, demand, formatValue, parse, isRankArray, isRankPlan, isRankTuple, isNativeFunction, isRankSequence, type RankArray, type NativeFunction, type SequencePlan } from '../src/index.js';
import { sequence, windowValue } from '../src/sequence.js';
import { isStoredValue } from '../src/stored-value.js';
import { runExecution } from '../src/execution.js';
import { MemoryIo } from './support.js';
import { denseScalarItems, materializedArrayItems, derivedArray } from '../src/array-storage.js';

const euler4 = readFileSync(new URL('../../../demos/euler/004_palproduct.ra', import.meta.url), 'utf8');
const covariance = readFileSync(new URL('../../../demos/deepml/010_cov.ra', import.meta.url), 'utf8');
const windows = readFileSync(new URL('../../../demos/classic/windows.ra', import.meta.url), 'utf8');

describe.each([false, true])('explicit-plan demo migration (compilation=%s)', compilation => {
    it.each(['150', '150\n', '150\r\n'])('reads the AoC present target with its line ending: %j', input => {
        const source = readFileSync(new URL('../../../demos/aoc/2015/020_presents.ra', import.meta.url), 'utf8');
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), {
            compilation, io: new MemoryIo({ 'input.txt': input }), args: ['input.txt'],
        });
        try {
            runtime.execute(source);
            expect(output).toEqual(['8', '8']);
        } finally { runtime.dispose(); }
    });

    it('validates each AoC wrapping line before pulling the next one', () => {
        const source = readFileSync(new URL('../../../demos/aoc/2015/002_wrapping.ra', import.meta.url), 'utf8');
        const program = parse(source);
        const helpers = program.statements.filter(statement => statement.$type === 'FunctionStatement'
            || statement.$type === 'UseStatement');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        try {
            runtime.executeProgram({ ...program, statements: helpers }, []);
            runtime.variables.set('Lines', sequence({
                name: 'wrapping input', size: { kind: 'exact', value: 2n },
                *iterate() {
                    reads++;
                    yield 'bad';
                    reads++;
                    yield '2x3x4';
                },
            }));
            expect(() => runtime.execute('Lines solve')).toThrow(/integer|number/i);
            expect(reads).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('runs both AoC door-password searches with deterministic matching hashes', () => {
        const source = readFileSync(new URL('../../../demos/aoc/2016/005_chess.ra', import.meta.url), 'utf8');
        const program = parse(source);
        const helpers = program.statements.filter(statement => statement.$type === 'FunctionStatement'
            || statement.$type === 'UseStatement');
        const matches = [[16, 0], [1, 5], [1, 10], [8, 11], [0, 9],
            [2, 12], [3, 13], [4, 14], [5, 15], [6, 0], [7, 1]];
        const runtime = new Interpreter(() => {}, { compilation, md5: input => {
            const index = Number(String(input).slice('door'.length));
            const match = matches[index];
            if (!match) throw new Error('Password search passed the final matching hash');
            const hash = new Uint8Array(16);
            hash[2] = match[0]!;
            hash[3] = match[1]! * 16;
            return hash;
        } });
        try {
            runtime.executeProgram({ ...program, statements: helpers }, []);
            expect(runtime.execute('"door" part1')).toBe('11802345');
            expect(runtime.execute('"door" part2')).toBe('95cdef01');
        } finally { runtime.dispose(); }
    });

    it.each([
        ['005_commondivisors', '5 3 14 15 7 9', '7'],
        ['009_coprimepairs', '5 2 3 4 9 5', '8'],
    ] as const)('consumes the single-pass values through the deferred parameter in math %s', (name, input, expected) => {
        const source = readFileSync(new URL(`../../../demos/cses/math/${name}.ra`, import.meta.url), 'utf8');
        const tokens = input.split(' ');
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(output).toEqual([expected]);
            expect(reads).toBe(tokens.length);
            expect(runtime.variables.get('Values')).toMatchObject({ kind: 'sequence' });
            expect(isStoredValue(runtime.variables.get('Values')!)).toBe(false);
            expect(() => runtime.executeProgram(parse('Again = Values sum'), [])).toThrow(/already been consumed/);
            expect(reads).toBe(tokens.length);
        } finally { runtime.dispose(); }
    });

    it('counts the tree snapshot with native bounds without enumerating pair distances', () => {
        const source = readFileSync(new URL('../../../demos/cses/tree/016_fixedpaths2.ra', import.meta.url), 'utf8');
        const program = parse(source);
        const helpers = program.statements.filter(statement => statement.$type === 'FunctionStatement'
            || statement.$type === 'UseStatement');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram({ ...program, statements: helpers }, []);
            runtime.execute(`Tree = new graph (1 to 5) .undirected
for Node in 1 till 5
  Tree add Node (Node + 1)
end`);
            const lengths = runtime.execute('Tree pathlengths');
            if (lengths === undefined || !isRankSequence(lengths)) throw new Error('Expected native tree path lengths');
            const withoutEnumeration = (plan: SequencePlan): SequencePlan => ({
                ...plan,
                *iterate() { throw new Error('Pair distances must not be enumerated'); },
                withFilter: predicate => {
                    const filtered = plan.withFilter?.(predicate);
                    return filtered && withoutEnumeration(filtered);
                },
            });
            runtime.variables.set('Lengths', sequence(withoutEnumeration(lengths.plan)));
            expect(runtime.execute('Lengths 1 2 count_lengths')).toBe(7n);
            expect(runtime.execute('Lengths 2 2 count_lengths')).toBe(3n);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['009_countpaths', '5 2 1 2 2 3 3 4 4 5 1 3 2 5', '1 2 2 1 1', 'Values', 'Paths'],
        ['012_pathqueries2', '3 3 1 2 3 1 2 2 3 2 1 3 1 2 10 2 1 3', '3 10', 'RawQueries', 'Queries'],
    ] as const)('completes the deferred query input once in tree %s', (name, input, expected, raw, table) => {
        const source = readFileSync(new URL(`../../../demos/cses/tree/${name}.ra`, import.meta.url), 'utf8');
        const tokens = input.split(' ');
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(output).toEqual([expected]);
            expect(reads).toBe(tokens.length);
            expect(isStoredValue(runtime.variables.get(raw)!)).toBe(false);
            expect(isStoredValue(runtime.variables.get(table)!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['008_routes1', '3 3 1 2 5 2 3 7 1 3 20', ['0 5 12']],
        ['009_routes2', '4 2 3 1 2 5 2 3 7 1 3 1 4 2 2', ['12', '-1', '0']],
    ] as const)('keeps graph vertices deferred and distances ready in %s', (name, input, expected) => {
        const source = readFileSync(new URL(`../../../demos/cses/graph/${name}.ra`, import.meta.url), 'utf8');
        const tokens = input.split(' ');
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(output).toEqual(expected);
            expect(reads).toBe(tokens.length);
            expect(isStoredValue(runtime.variables.get('Nodes')!)).toBe(false);
            expect(isStoredValue(runtime.variables.get('Distances')!)).toBe(true);
            const distances = formatValue(runtime.variables.get('Distances')!);
            runtime.executeProgram(parse('Graph add 1 3 1'), []);
            expect(formatValue(runtime.execute('Distances')!)).toBe(distances);
        } finally { runtime.dispose(); }
    });

    it('streams denominations once while keeping the combination DP mutable', () => {
        const source = readFileSync(new URL('../../../demos/cses/dynamic/004_coincomb2.ra', import.meta.url), 'utf8');
        const tokens = ['3', '9', '2', '3', '5'];
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(output).toEqual(['3']);
            expect(reads).toBe(tokens.length);
            expect(runtime.variables.get('Coins')).toMatchObject({ kind: 'sequence' });
            expect(isStoredValue(runtime.variables.get('Coins')!)).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('streams list-removal positions while retaining values for indexed reads', () => {
        const source = readFileSync(new URL('../../../demos/cses/range/009_listremovals.ra', import.meta.url), 'utf8');
        const tokens = ['5', '2', '6', '1', '4', '2', '3', '1', '3', '1', '1'];
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(output).toEqual(['1 2 2 6 4']);
            expect(reads).toBe(tokens.length);
            expect(runtime.variables.get('Positions')).toMatchObject({ kind: 'sequence' });
            expect(isStoredValue(runtime.variables.get('Positions')!)).toBe(false);
            expect(isStoredValue(runtime.variables.get('Values')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('consumes ticket prices before customers through two explicit stdin resources', () => {
        const source = readFileSync(new URL('../../../demos/cses/sortnsrch/004_tickets.ra', import.meta.url), 'utf8');
        const tokens = ['5', '3', '5', '3', '7', '8', '5', '4', '8', '3'];
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(output).toEqual(['3 8 -1']);
            expect(reads).toBe(tokens.length);
            for (const name of ['Prices', 'Customers']) {
                expect(runtime.variables.get(name)).toMatchObject({ kind: 'sequence' });
                expect(isStoredValue(runtime.variables.get(name)!)).toBe(false);
            }
            expect(() => runtime.executeProgram(parse('Again = Prices sum'), [])).toThrow(/already been consumed/);
            expect(reads).toBe(tokens.length);
        } finally { runtime.dispose(); }
    });

    it('leaves the unread stdin tail after finding a CSES sum pair', () => {
        const source = readFileSync(new URL('../../../demos/cses/sortnsrch/007_twovalues.ra', import.meta.url), 'utf8');
        const tokens = ['5', '5', '2', '3', '99', '100', '101'];
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(output).toEqual(['1 2']);
            expect(reads).toBe(4);
            expect(runtime.variables.get('Values')).toMatchObject({ kind: 'sequence' });
        } finally { runtime.dispose(); }
    });

    it.each([
        ['002_misnum', ['5', '2', '3', '1', '5'], ['4'], 'Values'],
        ['022_digits', ['3', '7', '19', '12'], ['7', '4', '1'], 'Queries'],
    ] as const)('streams the single-pass stdin resource in CSES %s', (name, tokens, expected, binding) => {
        const source = readFileSync(new URL(`../../../demos/cses/intro/${name}.ra`, import.meta.url), 'utf8');
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(output).toEqual(expected);
            expect(reads).toBe(tokens.length);
            expect(runtime.variables.get(binding)).toMatchObject({ kind: 'sequence' });
            expect(isStoredValue(runtime.variables.get(binding)!)).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('prints a deferred CSES XOR grid one completed row at a time', () => {
        const source = readFileSync(new URL('../../../demos/cses/intro/019_mexgrid.ra', import.meta.url), 'utf8');
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => { reads++; return '3'; } },
        });
        try {
            runtime.execute(source);
            expect(reads).toBe(1);
            expect(output).toEqual(['0 1 2', '1 0 3', '2 3 0']);
            expect(isStoredValue(runtime.variables.get('Grid')!)).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('reads and stores coin probabilities once before running the mutable DP', () => {
        const source = readFileSync(new URL('../../../demos/atcoder/edpc/09_coin.ra', import.meta.url), 'utf8');
        const tokens = ['3', '0.30', '0.60', '0.80'];
        const output: string[] = [];
        let reads = 0;
        const runtime = new Interpreter(text => output.push(text), {
            compilation, input: { readToken: () => tokens[reads++] },
        });
        try {
            runtime.execute(source);
            expect(reads).toBe(4);
            expect(output).toHaveLength(1);
            expect(Number(output[0])).toBeCloseTo(0.612, 12);
            expect(isStoredValue(runtime.variables.get('P')!)).toBe(true);
            expect(formatValue(runtime.variables.get('P')!)).toBe('0.3 0.6 0.8');
        } finally { runtime.dispose(); }
    });

    it('streams Fibonacci forbidden-index inputs before retaining the inclusion-exclusion state', () => {
        const source = readFileSync(new URL('../../../demos/euler/399_squarefree.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--count=200', '--limit=300', '--prime-limit=53'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Index')).toBe(260n);
            expect(runtime.variables.get('Answer')).toBe('1608739584170445,9.7e53');
            expect(runtime.variables.get('Pr')).toMatchObject({ kind: 'sequence' });
            expect(isStoredValue(runtime.variables.get('Pr')!)).toBe(false);
            expect(isStoredValue(runtime.variables.get('Mods')!)).toBe(true);
            expect(runtime.executeProgram(parse('Again = Pr len'), [])).toBe(16n);
        } finally { runtime.dispose(); }
    });

    it('retains maze column cosines for reuse and defers the single row traversal', () => {
        const source = readFileSync(new URL('../../../demos/euler/380_mazes.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--rows=3', '--cols=3'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe('1.9200e2');
            for (const name of ['R', 'C', 'Rx']) expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Cx')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('recomputes deferred prime factorial terms over retained primes', () => {
        const source = readFileSync(new URL('../../../demos/euler/381_primefactorial.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=100'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(480n);
            expect(isStoredValue(runtime.variables.get('Ps')!)).toBe(true);
            for (const name of ['K', 'Inv', 'Terms']) expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            expect(runtime.executeProgram(parse('Again = Terms sum'), [])).toBe(480n);
        } finally { runtime.dispose(); }
    });

    it('shares explicit Mertens memo entries beyond the precomputed cutoff', () => {
        const source = readFileSync(new URL('../../../demos/euler/388_lines.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--n=40', '--cut=5'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(56335n);
            expect(runtime.executeProgram(parse('Cache 1'), [])).toBe(0n);
            expect(runtime.executeProgram(parse('Cache 2'), [])).toBe(-3n);
            expect(runtime.executeProgram(parse('40 mertens Cache', '<input>', { bindings: new Map([['mertens', [2]]]) }), [])).toBe(0n);
        } finally { runtime.dispose(); }
    });

    it('publishes orchard recursion memo entries through an explicit shared index', () => {
        const source = readFileSync(new URL('../../../demos/euler/351_orchards.ra', import.meta.url), 'utf8');
        const program = parse(source);
        const helpers = program.statements.filter(statement => statement.$type === 'FunctionStatement'
            || statement.$type === 'UseStatement');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram({ ...program, statements: helpers }, []);
            runtime.execute('Prefix = array 0 1 2 4 6 10 12 18 22 28 32\nCache = new index');
            expect(runtime.execute('100 100 10 Prefix Cache tots')).toBe(3044n);
            expect(runtime.execute('Cache 1')).toBe(3044n);
            expect(runtime.execute('Cache 2')).toBe(774n);
            expect(runtime.execute('100 100 10 Prefix Cache tots')).toBe(3044n);
        } finally { runtime.dispose(); }
    });

    it('defers Bezier derivative stages while retaining the shared sample grids', () => {
        const source = readFileSync(new URL('../../../demos/euler/363_bezier.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--steps=100'] });
        try {
            runtime.execute(source);
            for (const name of ['Odd', 'Even']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            for (const name of ['Dx', 'Dy', 'OO', 'EE']) expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            expect(runtime.executeProgram(parse('Again = (Dx ** 2 + Dy ** 2) sqrt sum'), [])).toBe(runtime.variables.get('SE'));
        } finally { runtime.dispose(); }
    });

    it('repeats special-partition counting with fresh tables before its deferred prime selection', () => {
        const source = readFileSync(new URL('../../../demos/euler/333_specialpartitions.ra', import.meta.url), 'utf8');
        const program = parse(source);
        const helpers = program.statements.filter(statement => statement.$type === 'FunctionStatement'
            || statement.$type === 'UseStatement');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram({ ...program, statements: helpers }, []);
            expect(runtime.execute('Saved = 100 solve')).toBe(233n);
            expect(runtime.execute('Saved = 100 solve')).toBe(233n);
        } finally { runtime.dispose(); }
    });

    it('rebuilds matrix input rows while deferring their single numeric conversion', () => {
        const source = readFileSync(new URL('../../../demos/euler/345_matrixsum.ra', import.meta.url), 'utf8');
        const boundary = source.indexOf('Dp = array shape');
        expect(boundary).toBeGreaterThan(0);
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            for (let run = 0; run < 2; run++) {
                // The official fixture covers the full DP; this checks the unchanged input stage.
                runtime.execute(source.slice(0, boundary));
                expect(isRankPlan(runtime.variables.get('Nums')!)).toBe(true);
                for (const name of ['Rows', 'A']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
                expect(runtime.variables.get('A')).toMatchObject({ kind: 'array', shape: [15, 15] });
                expect(runtime.execute('A 0 0')).toBe(7n);
                expect(runtime.execute('A 14 14')).toBe(805n);
            }
        } finally { runtime.dispose(); }
    });

    it('retains shared sliding-game bounds and defers the prime-count masks', () => {
        const source = readFileSync(new URL('../../../demos/euler/313_sliding.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--prime-limit=100'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(5482n);
            for (const name of ['Ps', 'H', 'Low', 'High']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            for (const name of ['Sq', 'Fit', 'Count', 'Ways']) expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('matches interval minimax costs beyond the unrestricted prefix', () => {
        const source = readFileSync(new URL('../../../demos/euler/328_lowestcost.ra', import.meta.url), 'utf8');
        const program = parse(source);
        const helpers = program.statements.filter(statement => statement.$type === 'FunctionStatement'
            || statement.$type === 'UseStatement');
        const runtime = new Interpreter(() => {}, { compilation });
        const n = 256;
        // Independent interval DP tries every guess; it does not use the tree-shape shortcut.
        const cost = Array.from({ length: n + 2 }, () => Array<number>(n + 2).fill(0));
        for (let length = 2; length <= n; length++) {
            for (let lo = 1; lo + length - 1 <= n; lo++) {
                const hi = lo + length - 1;
                let best = Infinity;
                for (let guess = lo; guess <= hi; guess++) {
                    best = Math.min(best, guess + Math.max(cost[lo][guess - 1], cost[guess + 1][hi]));
                }
                cost[lo][hi] = best;
            }
        }
        const totals = [0, 0];
        for (let hi = 2; hi <= n; hi++) totals[hi] = totals[hi - 1] + cost[1][hi];
        expect(totals[101]).toBe(17981);
        try {
            runtime.executeProgram({ ...program, statements: helpers }, []);
            for (const limit of [0, 1, 2, 7, 8, 15, 16, 23, 31, 32, 63, 64, 99, 100, 101, 127, 128, 200, 255, 256]) {
                expect(runtime.execute(`${limit} costs`), `N=${limit}`).toBe(BigInt(totals[limit]));
            }
        } finally { runtime.dispose(); }
    });

    it('rebuilds amnesia states before deferred column weights on repeated runs', () => {
        const source = readFileSync(new URL('../../../demos/euler/298_selectiveamnesia.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--turns=5'] });
        try {
            for (let run = 0; run < 2; run++) {
                runtime.execute(source);
                expect(runtime.variables.get('Answer')).toBe(0);
                expect(isStoredValue(runtime.variables.get('Dp')!)).toBe(true);
                expect(isRankPlan(runtime.variables.get('Cols')!)).toBe(true);
                expect(isRankPlan(runtime.variables.get('Ab')!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    }, 30_000);

    it('allows rebuilding protein contact tables after consuming their one-use views', () => {
        const source = readFileSync(new URL('../../../demos/euler/300_proteinfolding.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--n=5'] });
        try {
            for (let run = 0; run < 2; run++) {
                runtime.execute(source);
                expect(runtime.variables.get('Answer')).toBe(1.4375);
                for (const name of ['Bm', 'Best', 'Cb']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    });

    it('completes both Fibonacci states after deferred doubling branches', () => {
        const source = readFileSync(new URL('../../../demos/euler/304_primonacci.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation,
            args: ['--start=10', '--count=4', '--mod=1000000007'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(6100n);
            for (const name of ['Pr', 'F0', 'F1']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            expect(formatValue(runtime.variables.get('F0')!)).toBe('89 233 1597 4181');
        } finally { runtime.dispose(); }
    });

    it('streams the periodic paper-strip lookup and still permits rebuilding the Grundy table', () => {
        const source = readFileSync(new URL('../../../demos/euler/306_paperstrip.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=200'] });
        // Independent DP: consider every possible removed pair, without the period shortcut.
        const grundy = Array<number>(201).fill(0);
        for (let n = 2; n <= 200; n++) {
            const moves = new Set(Array.from({ length: n - 1 }, (_, left) => grundy[left] ^ grundy[n - left - 2]));
            while (moves.has(grundy[n])) grundy[n]++;
        }
        const wins = BigInt(grundy.slice(1).filter(value => value !== 0).length);
        expect(wins).toBe(167n);
        try {
            for (let run = 0; run < 2; run++) {
                runtime.execute(source);
                expect(runtime.variables.get('Answer')).toBe(wins);
                expect(isStoredValue(runtime.variables.get('G')!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    });

    it('retains the triangle prefix and mutable Moebius table while deferring the final lookup', () => {
        const source = readFileSync(new URL('../../../demos/euler/276_primitivetriangles.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=100'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(6033n);
            for (const name of ['N', 'Cum', 'Mu']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            for (const name of ['Odd', 'Base', 'Tri', 'Quot', 'Pick']) {
                expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    });

    it('completes the pizza factorial prefix once from a deferred range', () => {
        const source = readFileSync(new URL('../../../demos/euler/281_pizzatoppings.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--max-m=3', '--max-n=2', '--limit=2'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(5n);
            expect(isRankPlan(runtime.variables.get('Facts')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Fact')!)).toBe(true);
            expect(formatValue(runtime.variables.get('Fact')!)).toBe('1 1 2 6 24 120 720');
        } finally { runtime.dispose(); }
    });

    it('allows repeated steady-square digit-table construction before the deferred sums', () => {
        const source = readFileSync(new URL('../../../demos/euler/284_steadysquares.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--n=9'] });
        try {
            for (let run = 0; run < 2; run++) {
                runtime.execute(source);
                expect(runtime.variables.get('Answer')).toBe('2d8');
                for (const name of ['D', 'Cum', 'Top', 'TopB', 'Ds']) {
                    expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
                }
                for (const name of ['SumB', 'Zero', 'Rest']) {
                    expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
                }
            }
        } finally { runtime.dispose(); }
    });

    it('evaluates the actual mountain height and deferred visibility helpers without the contour search', () => {
        const source = readFileSync(new URL('../../../demos/euler/262_mountainrange.ra', import.meta.url), 'utf8');
        const program = parse(source);
        const helpers = program.statements.filter(statement => statement.$type === 'FunctionStatement'
            || statement.$type === 'UseStatement');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram({ ...program, statements: helpers }, []);
            const atOrigin = runtime.execute('0.0 hgt 0.0');
            expect(atOrigin).toBeCloseTo(5000 * Math.exp(-0.7), 9);
            const grid = runtime.execute('Grid = ((array 0.0 1600.0) reshape 2 1) hgt (array 0.0 1600.0)')!;
            expect(grid).toMatchObject({ kind: 'array', shape: [2, 2] });
            const expected = [5000 * Math.exp(-0.7), 12200 * Math.exp(-0.86),
                12200 * Math.exp(-0.86), 6600 * Math.exp(-1.02)];
            (grid as RankArray).items.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 9));
            // Visibility owns its threshold; the helpers need no outer contour state.
            expect(runtime.execute('200.0 200.0 200.0 200.0 8000.0 visible')).toBe(true);
            expect(runtime.execute('200.0 200.0 200.0 200.0 7000.0 visible')).toBe(false);
            expect(runtime.execute('200.0 200.0 1400.0 1400.0 10400.0 visible')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('retains sorted divisor tables and defers pseudo-square-root products', () => {
        const source = readFileSync(new URL('../../../demos/euler/266_pseudosquareroot.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=30'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(79534n);
            for (const name of ['A', 'B', 'Sa', 'Cut', 'Tag', 'Asked', 'Where', 'Ok']) {
                expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            }
            for (const name of ['Keys', 'Mark', 'Before', 'Which', 'Pick', 'Mate', 'Prod']) {
                expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    });

    it('retains the optimal betting fractions and streams the binomial tail', () => {
        const source = readFileSync(new URL('../../../demos/euler/267_billionaire.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--n=20', '--goal=20'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(0.131587982178);
            for (const name of ['H', 'F']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            for (const name of ['Growth', 'Need', 'Fits', 'Tail', 'Ways']) {
                expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    });

    it('keeps race rows writable while reducing deferred action candidates', () => {
        const source = readFileSync(new URL('../../../demos/euler/232_race.ra', import.meta.url), 'utf8');
        let entries = 0, maxKernels = 0;
        const runtime = new Interpreter(() => {}, { compilation, args: ['--goal=3'],
            onTensorKernelExecuted: () => entries++,
            onTensorKernelCompiled: source => { if (source.includes('tensor:terminal-type:max')) maxKernels++; } });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(0.54403292);
            for (const name of ['P', 'G', 'F', 'Hn']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            if (compilation) expect(entries).toBeGreaterThanOrEqual(9);
            else expect(entries).toBe(0);
            expect(maxKernels).toBe(compilation ? 1 : 0);
        } finally { runtime.dispose(); }
    });

    it('packs ready digit words through the actual infinite-string merge stage', () => {
        const source = readFileSync(new URL('../../../demos/euler/238_infinitestring.ra', import.meta.url), 'utf8');
        const start = source.indexOf('Nw = Words len');
        const end = source.indexOf('Full = ', start);
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use bits\nuse numbers\nuse sequences\nWords = array 1 2 3');
            // Run the unchanged merge stage, without the expensive period search.
            runtime.execute(source.slice(start, end));
            expect(runtime.variables.get('B')).toBe(1n + (2n << 52n) + (3n << 104n));
            expect(isStoredValue(runtime.variables.get('Ws')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('retains the odd-triplet bit counts and defers their weighted sum', () => {
        const source = readFileSync(new URL('../../../demos/euler/242_oddtriplets.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=100'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(139n);
            for (const name of ['I', 'Bit']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            for (const name of ['Above', 'Share']) expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('retains shared tangent bounds while deferring the final lattice-point count', () => {
        const source = readFileSync(new URL('../../../demos/euler/246_tangents.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--radius=400', '--gap=300'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(538584n);
            for (const name of ['R', 'K', 'W', 'Top', 'N', 'Low']) {
                expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            }
            for (const name of ['Pos', 'Ok', 'Under', 'Cnt', 'Per', 'Used']) {
                expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    });

    it('retains flea degrees and state while deferring the empty-square product', () => {
        const source = readFileSync(new URL('../../../demos/euler/213_fleacircus.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            // N=4 takes the outer branch. Lift that branch for this binding
            // audit: its local names are intentionally absent from globals.
            const program = parse(source);
            runtime.executeProgram({ ...program, statements: program.statements.flatMap(statement =>
                statement.$type === 'IfStatement' ? statement.thenStatements : [statement]) }, ['--n=4', '--rings=2']);
            expect(runtime.variables.get('Answer')).toBe(5.215096);
            for (const name of ['Deg', 'Inv', 'Wt', 'D']) {
                expect(runtime.variables.has(name), name).toBe(true);
                expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            }
            for (const name of ['Hit', 'Dm', 'Pq', 'Empty']) {
                expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    });

    it('retains crack-free wall transitions and completes each wall-height state', () => {
        const source = readFileSync(new URL('../../../demos/euler/215_crackfree.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--width=9', '--height=3'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(8n);
            for (const name of ['Rows', 'Ah', 'Al', 'Key', 'Ways']) {
                expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            }
            for (const name of ['Hc', 'Lc', 'Hx', 'Lx', 'Dh', 'Dl']) {
                expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            }
        } finally { runtime.dispose(); }
    });

    it('retains the totient sieve while streaming the final polygon-direction selection', () => {
        const source = readFileSync(new URL('../../../demos/euler/228_minkowski.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--lo=3', '--hi=7'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(18n);
            for (const name of ['Q', 'Phi', 'Ns']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            for (const name of ['Rows', 'Zero', 'Divides', 'Used']) {
                expect(isRankPlan(runtime.variables.get(name)!)).toBe(true);
            }
            expect(runtime.executeProgram(parse('Used sum'), [])).toBe(18n);
        } finally { runtime.dispose(); }
    });

    it('retains dice histograms and defers pairwise win selection', () => {
        const source = readFileSync(new URL('../../../demos/euler/205_dicegame.ra', import.meta.url), 'utf8');
        let entries = 0;
        const runtime = new Interpreter(() => {}, { compilation, args: ['--pn=1', '--cn=1'],
            onTensorKernelExecuted: () => entries++ });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(0.25);
            for (const name of ['Hp', 'Hc']) {
                const histogram = runtime.variables.get(name)!;
                expect(histogram).toMatchObject({ kind: 'array', shape: [7] });
                expect(isStoredValue(histogram)).toBe(true);
            }
            expect(formatValue(runtime.variables.get('Hp')!)).toBe('0 1 1 1 1 0 0');
            expect(formatValue(runtime.variables.get('Hc')!)).toBe('0 1 1 1 1 1 1');
            expect(isRankPlan(runtime.variables.get('Pair')!)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Won')!)).toBe(true);
            // Native completion also compiles the two histogram masks.
            expect(entries).toBe(compilation ? 16 : 0);
        } finally { runtime.dispose(); }
    });

    it('retains smooth-number lists while streaming the final prefix-count selection', () => {
        const source = readFileSync(new URL('../../../demos/euler/204_hammingnumbers.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=100000000', '--max=5'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(1105n);
            for (const name of ['Lo', 'Hi', 'Sorted']) expect(isStoredValue(runtime.variables.get(name)!)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Below')!)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Query')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('retains the colour transition tensor and completes each planned matrix sweep', () => {
        const source = readFileSync(new URL('../../../demos/euler/189_tricolouring.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--rows=3'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(528n);
            expect(isRankPlan(runtime.variables.get('Diff')!)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Third')!)).toBe(true);
            const transition = runtime.variables.get('Fac')!;
            expect(transition).toMatchObject({ kind: 'array', shape: [3, 3, 3] });
            expect(isStoredValue(transition)).toBe(true);
            const state = runtime.variables.get('V')!;
            expect(state).toMatchObject({ kind: 'array', shape: [27] });
            expect(isStoredValue(state)).toBe(true);
            expect(runtime.executeProgram(parse('Fac 0 0 0'), [])).toBe(2n);
            expect(runtime.executeProgram(parse('Fac 0 1 2'), [])).toBe(0n);
        } finally { runtime.dispose(); }
    });

    it('uses native kernels for the actual cross-hatched triangle predicates', () => {
        const source = readFileSync(new URL('../../../demos/euler/163_crosshatched.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--size=2'] });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(104n);
            if (compilation) expect(diagnostics.compiledTensors).toBeGreaterThan(0);
            else expect(diagnostics.compiledTensors).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('completes each hyperbinary matrix step after deferred pair selections', () => {
        const source = readFileSync(new URL('../../../demos/euler/169_hyperbinary.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--power=1'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(5n);
            expect(isRankPlan(runtime.variables.get('Zero')!)).toBe(true);
            const result = runtime.variables.get('R')!;
            expect(result).toMatchObject({ kind: 'array', shape: [1, 2, 2] });
            expect(isStoredValue(result)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('retains row prefixes and reduces the actual maximum-run helper through native kernels', () => {
        const source = readFileSync(new URL('../../../demos/euler/149_maxsubsequence.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use numbers\nuse sequences');
            runtime.declareFunctionSource(source);
            const best = runtime.variables.get('best')!;
            if (!isNativeFunction(best)) throw new Error('expected best function');
            const input: RankArray = { kind: 'array', items: [5n, -100n, 1n, 6n, -100n, 2n], shape: [2, 3] };
            const result = diagnostics.run(() => best.call([input]));
            if (!isRankPlan(result)) throw new Error('expected a maximum-run plan');
            const gain = result.dependencies.get('Gain')!;
            if (!isRankPlan(gain)) throw new Error('expected deferred prefix differences');
            const ends = gain.dependencies.get('Ends')!;
            const before = gain.dependencies.get('Before')!;
            if (!isRankPlan(ends) || !isRankPlan(before)) throw new Error('expected deferred prefix selections');
            expect(isStoredValue(ends.dependencies.get('Sums')!)).toBe(true);
            expect(isStoredValue(before.dependencies.get('Low')!)).toBe(true);
            expect(diagnostics.run(() => runExecution(demand(result)))).toBe(6n);
            expect(diagnostics.run(() => runExecution(demand(result)))).toBe(6n);
            if (compilation) expect(diagnostics.compiledTensors).toBeGreaterThan(0);
            else expect(diagnostics.compiledTensors).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('completes the archived repunit tables before deferred searches read the final version', () => {
        const source = readFileSync(new URL('../../../benchmarks/fixtures/euler129-batched.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--limit=10'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(17n);
            const table = runtime.variables.get('Tab')!;
            expect(table).toMatchObject({ kind: 'array', shape: [12, 16] });
            expect(isStoredValue(table)).toBe(true);
            const cut = runtime.variables.get('Cut')!;
            expect(isRankPlan(cut)).toBe(true);
            if (!isRankPlan(cut)) throw new Error('expected a table selection plan');
            expect(cut.dependencies.get('Tab')).toBe(table);
            expect(runExecution(demand(cut))).toMatchObject({ kind: 'array', shape: [12, 10] });
            expect(runtime.executeProgram(parse('Tab 0 0'), [])).toBe(10n);
            expect(runtime.executeProgram(parse('Tab 0 1'), [])).toBe(1n);
            expect(runtime.executeProgram(parse('Tab 0 15'), [])).toBe(1n);
            expect(isRankPlan(runtime.variables.get('Short')!)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Long')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('retains shared block masks while deferring the combinatorial reduction', () => {
        const source = readFileSync(new URL('../../../demos/euler/114_blocks1.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: ['--size=7'] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(17n);
            expect(isStoredValue(runtime.variables.get('Fits')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('K')!)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Ways')!)).toBe(true);
            const total = runtime.variables.get('Total')!;
            expect(isRankPlan(total)).toBe(true);
            expect(runExecution(demand(total))).toBe(16n);
            expect(runExecution(demand(total))).toBe(16n);
        } finally { runtime.dispose(); }
    });

    it('reduces deferred checkout tensors through native kernels without retaining the full totals', () => {
        const source = readFileSync(new URL('../../../demos/euler/109_darts.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(38182n);
            expect(isRankPlan(runtime.variables.get('Total')!)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Fits')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Any')!)).toBe(true);
            if (compilation) expect(diagnostics.compiledTensors).toBeGreaterThan(0);
            else expect(diagnostics.compiledTensors).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('retains Monopoly state while composing deferred matrices through native kernels', () => {
        const source = readFileSync(new URL('../../../demos/euler/084_monopolyodds.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(101524n);
            expect(isRankPlan(runtime.variables.get('Mat')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Land')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Seen')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Sq')!)).toBe(true);
            expect(runtime.execute('Land 36 5')).toBe(0.1875);
            if (compilation) expect(diagnostics.compiledTensors).toBeGreaterThan(0);
            else expect(diagnostics.compiledTensors).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('stops the actual pandigital-prime pipeline before completing all permutations', () => {
        const source = readFileSync(new URL('../../../demos/euler/041_pandigitalprime.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let conversions = 0;
        const integer: NativeFunction = { kind: 'function', name: 'integer', arities: [1], monadicRank: 'all',
            call([value]) { conversions++; return BigInt(value as string); },
        };
        try {
            runtime.execute('use algo\nuse sequences');
            runtime.variables.set('integer', integer);
            runtime.declareFunctionSource(source);
            expect(runtime.execute('"7654321" largest_pandigital_prime')).toBe(7652413n);
            const first = conversions;
            expect(first).toBeGreaterThan(0);
            expect(first).toBeLessThan(5040);
            expect(runtime.execute('"7654321" largest_pandigital_prime')).toBe(7652413n);
            expect(conversions - first).toBe(first);
        } finally { runtime.dispose(); }
    });

    it('streams deals through the actual poker helper while retaining each hand for scoring', () => {
        const source = readFileSync(new URL('../../../demos/euler/054_poker.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        const observed: number[] = [];
        const deals = [
            '5H 5C 6S 7S KD 2C 3S 8S 8D TD', '5D 8C 9S JS AC 2C 5C 7D 8S QH',
            '2D 9C AS AH AC 3D 6D 7D TD QD', '4D 6S 9H QH QC 3D 6D 7H QD QS',
            '2H 2D 4C 4D 4S 3C 3D 3S 9S 9D',
        ];
        runtime.variables.set('Deals', sequence({ name: 'poker deals', size: { kind: 'exact', value: 5n },
            *iterate() { for (const deal of deals) { reads++; yield deal; } },
        }));
        try {
            runtime.execute('use sequences\nuse text\nRanks = "23456789TJQKA"');
            runtime.declareFunctionSource(source);
            const score = runtime.variables.get('hand_score')!;
            if (!isNativeFunction(score)) throw new Error('expected hand score');
            runtime.variables.set('hand_score', { kind: 'function', name: 'hand_score', arities: [1], monadicRank: 'all',
                call(args) { observed.push(reads); return score.call(args); },
            });
            expect(runtime.execute('Deals poker_wins')).toBe(3n);
            expect(observed).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
            expect(reads).toBe(5);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['047_primefactors', '2 distinct_factor_run', 14n],
        ['051_primedigits', '121313 has_eight_prime_family', true],
        ['052_permutedmultiples', '142857 permuted', true],
        ['056_digitsum', '(2 ** 1000) digit_sum', 1366n],
        ['059_xor', '((array 65) decrypt (array 42) equal (array 107)) all', true],
        ['060_primepairs', 'Data = 20 build\nRows = Data .rows\n((Rows 0) band 2) equal 2', true],
    ] as const)('runs the actual Euler %s helper on a small input', (name, expression, expected) => {
        const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use algo\nuse numbers\nuse sequences\nuse bits\nuse graph');
            runtime.declareFunctionSource(source);
            expect(runtime.execute(expression)).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it('runs the actual Euler 021 top-level search on a bounded input', () => {
        const source = readFileSync(new URL('../../../demos/euler/021_amicable.ra', import.meta.url), 'utf8');
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(source.replace('arg Limit integer = 10000', 'arg Limit integer = 300'));
            expect(runtime.variables.get('Answer')).toBe(504n);
            expect(output).toEqual(['504']);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['021_amicable', '220 proper_divisor_sum', 284n],
        ['021_amicable', '284 proper_divisor_sum', 220n],
        ['021_amicable', '16 proper_divisor_sum', 15n],
        ['030_digitpowers', '1634 digit_power_sum 4', 1634n],
        ['030_digitpowers', '1 digit_power_numbers', 44n],
        ['035_circularprimes', '100 circular_prime_count', 13n],
    ] as const)('runs the actual Euler %s helper on a bounded input: %s', (name, expression, expected) => {
        const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use numbers\nuse sequences');
            runtime.declareFunctionSource(source);
            expect(runtime.execute(expression)).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['022_sigmoid', 'sigmoid', [3], '0.2689 0.5 0.7311'],
        ['035_diag', 'make_diagonal', [3, 3], '-1 0 0 0 0 0 0 0 1'],
        ['042_relu', 'relu', [3], '0 0 1'],
    ] as const)('keeps a planned input deferred through %s', (name, helper, shape, expected) => {
        const source = readFileSync(new URL(`../../../demos/deepml/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        runtime.variables.set('Input', derivedArray([3], [], index => { reads++; return BigInt(index - 1); }));
        try {
            runtime.execute(source);
            runtime.execute(`Result' = Input ${helper}`);
            expect(reads).toBe(0);
            expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
            const saved = runtime.execute('Saved = Result')!;
            expect(saved).toMatchObject({ shape });
            expect(formatValue(saved)).toBe(expected);
            expect(isStoredValue(saved)).toBe(true);
            const before = reads;
            expect(formatValue(runtime.execute('Result')!)).toBe(expected);
            expect(reads).toBeGreaterThan(before);
            const after = reads;
            expect(formatValue(runtime.execute('Saved')!)).toBe(expected);
            expect(reads).toBe(after);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['041_conv2d', [3, 3], 'Input Kernel 0 1 simple_conv2d', [2, 2], '12 16 24 28'],
        ['045_kernel', [2, 2], 'Input kernel_function Identity', [2, 2], '1 2 3 4'],
        ['055_translate', [2, 2], 'Input 10 (-1) translate_object', [2, 2], '11 1 13 3'],
    ] as const)('keeps planned matrix data deferred through %s', (name, inputShape, expression, outputShape, expected) => {
        const source = readFileSync(new URL(`../../../demos/deepml/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        runtime.variables.set('Input', derivedArray([...inputShape], [], index => { reads++; return BigInt(index + 1); }));
        try {
            runtime.execute(source);
            runtime.execute('Kernel = array shape 2 2 fill 1\nIdentity = array shape 2 2\n1 0\n0 1\nend');
            runtime.execute(`Result' = ${expression}`);
            expect(reads).toBe(0);
            expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
            const saved = runtime.execute('Saved = Result')!;
            expect(saved).toMatchObject({ shape: outputShape });
            expect(formatValue(saved)).toBe(expected);
            const afterSaved = reads;
            expect(afterSaved).toBeGreaterThan(0);
            expect(formatValue(runtime.execute('Result')!)).toBe(expected);
            expect(reads).toBeGreaterThan(afterSaved);
            const after = reads;
            expect(formatValue(runtime.execute('Saved')!)).toBe(expected);
            expect(reads).toBe(after);
        } finally { runtime.dispose(); }
    });

    it('executes Adam callbacks once per step and retains its completed iteration state', () => {
        const source = readFileSync(new URL('../../../demos/deepml/049_adam.ra', import.meta.url), 'utf8');
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(source);
            runtime.execute([
                'use io', 'fun X gradient', ' "gradient" print', ' return X * 2', 'end',
                'Input = array 1.0 1.0', "Result' = Input adam_optimizer gradient",
            ].join('\n'));
            expect(output).toEqual(Array(10).fill('gradient'));
            expect(formatValue(runtime.execute('Result round 8')!)).toBe('0.99000325 0.99000325');
            expect(formatValue(runtime.execute('Result round 8')!)).toBe('0.99000325 0.99000325');
            expect(output).toHaveLength(10);
            expect(formatValue(runtime.execute('Input')!)).toBe('1 1');
        } finally { runtime.dispose(); }
    });

    it('retains one shuffle order while returning deferred sample selections', () => {
        const source = readFileSync(new URL('../../../demos/deepml/029_shuf.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source);
            runtime.execute('use sequences');
            runtime.execute([
                'State = 42 seed', 'X = array shape 4 1', '10 20 30 40', 'end',
                'Y = array 1 2 3 4', "Result' = X shuffle_data Y",
                'State = 999 seed', 'First = Result', 'Second = Result',
            ].join('\n'));
            expect(formatValue(runtime.variables.get('First')!)).toBe(formatValue(runtime.variables.get('Second')!));
            runtime.execute('unpack ShuffledX ShuffledY = First');
            expect(runtime.execute('ShuffledX len equal 4')).toBe(true);
            expect(runtime.execute('((ShuffledX reshape 4) equal (ShuffledY * 10)) all')).toBe(true);
            expect(runtime.execute('(ShuffledY sort equal (array 1 2 3 4)) all')).toBe(true);
            const saved = runtime.variables.get('First')!;
            if (!isRankTuple(saved)) throw new Error('expected retained sample pair');
            expect(saved.items).toHaveLength(2);
            for (const item of saved.items) {
                expect(denseScalarItems(item as RankArray)).toBeDefined();
            }
        } finally { runtime.dispose(); }
    });

    it('runs the actual matrix-product dot plans through native reductions when compilation is enabled', () => {
        const source = readFileSync(new URL('../../../demos/deepml/009_matmul.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(source);
            const result = diagnostics.run(() => runtime.execute([
                'A = array shape 2 3', '1 2 3', '4 5 6', 'end',
                'B = array shape 3 2', '7 8', '9 10', '11 12', 'end',
                'Result = A matrixmul B',
            ].join('\n')))!;
            expect(result).toMatchObject({ kind: 'array', shape: [2, 2] });
            expect(formatValue(result)).toBe('58 64 139 154');
            expect(isStoredValue(result)).toBe(true);
            expect(diagnostics.compiledTensors).toBe(compilation ? 4 : 0);
        } finally { runtime.dispose(); }
    });

    it('passes a planned tensor through the actual scalar-multiply helper without reading it on entry', () => {
        const source = readFileSync(new URL('../../../demos/deepml/005_scalmul.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        runtime.variables.set('Input', derivedArray([2, 2], [], index => { reads++; return BigInt(index + 1); }));
        try {
            runtime.execute(source);
            runtime.execute("Result' = Input scalar_multiply 3");
            expect(reads).toBe(0);
            expect(isRankPlan(runtime.variables.get('Result')!)).toBe(true);
            const saved = runtime.execute('Saved = Result')!;
            expect(formatValue(saved)).toBe('3 6 9 12');
            expect(isStoredValue(saved)).toBe(true);
            const afterSaved = reads;
            expect(afterSaved).toBeGreaterThan(0);
            expect(runtime.execute('Result sum')).toBe(30n);
            expect(reads).toBeGreaterThan(afterSaved);
            const afterDemand = reads;
            expect(runtime.execute('Saved sum')).toBe(30n);
            expect(reads).toBe(afterDemand);
        } finally { runtime.dispose(); }
    });

    it('streams values through the actual fold helper without completing its input on entry', () => {
        const source = readFileSync(new URL('../../../demos/classic/fold.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        let reads = 0;
        const observed: number[] = [];
        const input = sequence({ name: 'fold input', size: { kind: 'exact', value: 4n },
            *iterate() { for (let value = 1n; value <= 4n; value++) { reads++; yield value; } },
        });
        const combine: NativeFunction = { kind: 'function', name: 'observed addition', arities: [2], monadicRank: 'all',
            call([left, right]) { observed.push(reads); return (left as bigint) + (right as bigint); },
        };
        try {
            runtime.execute(source);
            const fold = runtime.variables.get('fold')!;
            if (!isNativeFunction(fold)) throw new Error('expected fold function');
            expect(fold.call([input, combine, 0n])).toBe(10n);
            expect(observed).toEqual([1, 2, 3, 4]);
            expect(reads).toBe(4);
        } finally { runtime.dispose(); }
    });

    it.each(['queens', 'queens_permutations', 'queens_recursive'])('keeps %s board rendering deferred over retained solutions', name => {
        const source = readFileSync(new URL(`../../../demos/classic/${name}.ra`, import.meta.url), 'utf8');
        const rendering = source.slice(source.indexOf("Mask' ="), source.indexOf('for Board i in Boards'));
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nuse text\nStates = array shape 1 4\n1 3 0 2\nend\nSols = States\nPlacements = States\nCols = array 0 1 2 3\nRow = Cols');
            diagnostics.run(() => runtime.execute(rendering));
            expect(diagnostics.cellsComputed).toBe(0);
            const boards = runtime.variables.get('Boards')!;
            expect(isRankPlan(boards)).toBe(true);
            const view = diagnostics.run(() => runExecution(demand(boards))) as RankArray;
            expect(view.shape).toEqual([1, 4, 4]);
            expect(isStoredValue(view)).toBe(false);
            expect(diagnostics.cellsComputed).toBe(0);
            expect(formatValue(view)).toBe('. Q . . . . . Q Q . . . . . Q .');
            expect(formatValue(runExecution(demand(boards)))).toBe(formatValue(view));
            expect(isStoredValue(runtime.variables.get('States')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['005_smallestmultiple', 20, 232792560n],
        ['006_sumsquarediff', 10000, (10000n * 10001n / 2n) ** 2n - 10000n * 10001n * 20001n / 6n],
    ] as const)('streams Euler %s at limit %s', (name, limit, expected) => {
        const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(expected);
            expect(isStoredValue(runtime.variables.get('Range')!)).toBe(false);
            if (name === '006_sumsquarediff') expect(isStoredValue(runtime.variables.get('Squares')!)).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('keeps windows deferred through an explicit helper parameter', () => {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences');
            runtime.declareFunctionSource("fun Windows' products\n  return Windows reduce * axis 1 max\nend");
            const fn = runtime.variables.get('products')!;
            if (!isNativeFunction(fn)) throw new Error('expected products function');
            const input: RankArray = { kind: 'array', items: [1n, 2n, 3n, 4n], shape: [4] };
            const view = windowValue(input, 2n);
            const result = diagnostics.run(() => fn.call([view]));
            expect(diagnostics.cellsComputed).toBe(0);
            if (!isRankPlan(result)) throw new Error('expected a deferred reduction');
            const windows = result.dependencies.get('Windows')!;
            expect(windows).toMatchObject({ kind: 'array', shape: [3, 2] });
            expect(isStoredValue(windows)).toBe(false);
            expect(runExecution(demand(result))).toBe(12n);
            expect(runExecution(demand(result))).toBe(12n);
        } finally { runtime.dispose(); }
    });

    it('retains the single-pass Fibonacci generator for both consumers', () => {
        const source = readFileSync(new URL('../../../demos/euler/002_evenfib.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(4613732n);
            expect(isStoredValue(runtime.variables.get('Fib')!)).toBe(true);
            expect(isStoredValue(runtime.variables.get('Mask')!)).toBe(true);
        } finally { runtime.dispose(); }
    });

    it.each([
        ['001_multiples', 1000, 'Mask', 'Mask 0 = true', 233168n],
        ['014_collatz', 14, 'Lengths', 'Lengths 0 = 999', 9n],
        ['127_abchits', 1000, 'Rad', 'Rad 0 = 999', 12523n],
        ['159_digitalrootsums', 100, 'Best', 'Best 0 = 999', 856n],
        ['179_consecutivedivisors', 1000, 'Cnt', 'Cnt 0 = 999', 118n],
        ['187_semiprimes', 1000, 'Lo', 'Lo 0 = 999', 299n],
    ] as const)('retains writable working data in Euler %s', (name, limit, binding, mutation, expected) => {
        const source = readFileSync(new URL(`../../../demos/euler/${name}.ra`, import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`] });
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(expected);
            expect(isStoredValue(runtime.variables.get(binding)!)).toBe(true);
            runtime.executeProgram(parse(mutation), []);
            expect(runtime.variables.get('Answer')).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it('keeps generated-grid windows deferred and materializes an explicit retained result', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(windows));
            expect(output).toEqual(['1 2 4 5 2 3 5 6 4 5 7 8 5 6 8 9', '1 5 9', '3 5 7']);
            const blocks = runtime.variables.get('Blocks')!;
            expect(isRankPlan(blocks)).toBe(true);
            const before = diagnostics.cellsComputed;
            const view = diagnostics.run(() => runExecution(demand(blocks))) as RankArray;
            expect(view.shape).toEqual([2, 2, 2, 2]);
            expect(denseScalarItems(view)).toBeUndefined();
            expect(materializedArrayItems(view)).toBeUndefined();
            expect(diagnostics.cellsComputed).toBe(before);
            const saved = runtime.execute('Saved = Blocks') as RankArray;
            expect(saved.shape).toEqual([2, 2, 2, 2]);
            expect(denseScalarItems(saved)).toBeDefined();
            expect(formatValue(saved)).toBe(output[0]);
        } finally { runtime.dispose(); }
    });

    it('retains centered data while contracting observations without a transpose', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`${covariance}\nMatrix = array shape 2 3\n1 2 3\n4 5 6\nend\nResult' = Matrix covmatrix`);
            const result = runtime.variables.get('Result')!;
            expect(isRankArray(result)).toBe(true);
            if (!isRankArray(result)) throw new Error('expected a covariance view');
            expect(result.shape).toEqual([2, 2]);
            expect(denseScalarItems(result)).toBeUndefined();
            expect(materializedArrayItems(result)).toBeUndefined();
            expect(() => runtime.execute('Matrix 0 0 = 99')).toThrow('read-only');
            const saved = runtime.execute('Saved = Result') as RankArray;
            expect(saved.shape).toEqual([2, 2]);
            expect(formatValue(saved)).toBe('1 1 1 1');
            expect(denseScalarItems(saved)).toBeDefined();
            expect(formatValue(runtime.execute('Result')!)).toBe('1 1 1 1');
        } finally { runtime.dispose(); }
    });

    it('finds Euler 4 without completing the product table', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(euler4));
            expect(runtime.variables.get('Answer')).toBe(906609n);
            expect(output).toEqual(['906609']);
            expect(runtime.variables.get('Factors')).toMatchObject({ kind: 'array', shape: [900] });
            const products = runtime.variables.get('Products')!;
            expect(isRankPlan(products)).toBe(true);
            expect(isRankPlan(runtime.variables.get('Candidates')!)).toBe(true);
            // The symbolic outer implementation reports each computed product
            // through derived-array diagnostics. Early search reads a prefix.
            expect(diagnostics.cellsComputed).toBeGreaterThan(0);
            expect(diagnostics.cellsComputed).toBeLessThan(900 * 900);
            const before = diagnostics.cellsComputed;
            const native = diagnostics.run(() => runExecution(demand(products))) as RankArray;
            expect(native.shape).toEqual([900, 900]);
            expect(denseScalarItems(native)).toBeUndefined();
            expect(materializedArrayItems(native)).toBeUndefined();
            expect(diagnostics.cellsComputed).toBe(before);
        } finally { runtime.dispose(); }
    });
});
