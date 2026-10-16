import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
const { Interpreter, parse } = await import(process.env.RANK_INTERPRETER ?? '../packages/interpreter/out/index.js');

// npx tsc -b tsconfig.build.json && node benchmarks/queens-search.mjs
const definitions = {
    permutations: `Columns = 0 till 8 array
fun Q safe rank 1
  Up = Q + Columns unique len
  if Up not equal 8
    return false
  end
  Down = Q - Columns unique len
  return Down equal 8
end`,
    prefixes: `fun N queens
  Cols = 0 till N array
  States = array shape 1 N fill 0

  for Row in 0 till N
    Prefix = States # (0 till Row)
    Free = Prefix available rank 1
    Size = (States len) * N
    Flat = Free reshape Size
    Index = Flat indices

    if Index len equal 0
      return array shape 0 N fill 0
    end

    States = States (Index // N) copy
    States # Row = Index mod N
  end
  return States

  fun Q available
    Depth = Q len
    Rows = 0 till Depth array
    Dy = Depth - Rows
    Dx = Cols Q outer - abs
    Hit = Dx equal 0 or Dx equal Dy
    return not (Hit any axis 1)
  end
end`,
};
const solves = { permutations: 'Solutions = Columns permutations filter safe copy', prefixes: 'Solutions = 8 queens' };
definitions.batched = `fun N queens
  Cols = 0 till N array
  States = array shape 1 N fill 0
  for Row in 0 till N
    Prefix = States # (0 till Row)
    Dy = (Row - (0 till Row array)) reshape Row 1
    Dx = Prefix Cols outer - abs
    Hit = Dx equal 0 or Dx equal Dy
    Free = not (Hit any axis 1)
    Index = (Free reshape ((States len) * N)) indices
    if Index len equal 0
      return array shape 0 N fill 0
    end
    States = States (Index // N) copy
    States # Row = Index mod N
  end
  return States
end`;
solves.batched = 'Solutions = 8 queens';
definitions.membership = definitions.prefixes.replace(
    '    Dx = Cols Q outer - abs\n    Hit = Dx equal 0 or Dx equal Dy\n    return not (Hit any axis 1)',
    '    Blocked = concat Q (Q + Dy) (Q - Dy)\n    return Cols not in Blocked',
);
solves.membership = 'Solutions = 8 queens';
definitions.hoisted = definitions.membership
    .replace('  for Row in 0 till N\n', '  for Row in 0 till N\n    Dy = Row - (0 till Row array)\n')
    .replace('    Depth = Q len\n    Rows = 0 till Depth array\n    Dy = Depth - Rows\n', '');
solves.hoisted = 'Solutions = 8 queens';
const optimizedSource = readFileSync(new URL('./queens-optimized.ra', import.meta.url), 'utf8');
assert.equal(optimizedSource.slice(optimizedSource.indexOf('fun N queens')).trim(), definitions.hoisted.trim());
const rowsOf = value => Array.from({ length: value.shape[0] }, (_, r) =>
    Array.from({ length: value.shape[1] }, (_, c) => Number(value.itemAt?.(r * value.shape[1] + c) ?? value.items[r * value.shape[1] + c])));
function oracle(n) {
    const solutions = [], states = Array(n + 1).fill(0);
    function visit(row) {
        states[row.length]++;
        if (row.length === n) { solutions.push(row); return; }
        for (let col = 0; col < n; col++) {
            if (row.every((prior, i) => prior !== col && Math.abs(prior - col) !== row.length - i)) visit([...row, col]);
        }
    }
    visit([]);
    return { solutions, states };
}
const variant = process.argv.find(arg => arg.startsWith('--worker='))?.slice(9);
if (variant) {
    assert(variant in definitions);
    const setup = parse(`use algo\nuse sequences\nuse numbers\nuse io\n${definitions[variant]}`);
    const solve = parse(solves[variant]);
    const expected = oracle(8).solutions;
    const run = () => {
        const runtime = new Interpreter(() => {});
        runtime.executeProgram(setup);
        if (!process.env.PROFILE) global.gc();
        const start = performance.now();
        runtime.executeProgram(solve);
        const ms = performance.now() - start;
        const solutions = runtime.variables.get('Solutions');
        assert.deepEqual(solutions.shape, [92, 8]);
        assert.deepEqual(rowsOf(solutions), expected);
        runtime.dispose();
        return ms;
    };
    run();
    if (process.env.PROFILE) for (let i = 0; i < 12; i++) run();
    console.log(JSON.stringify({ ms: run() }));
} else {
    // Verify the submitted general-N function and its actual intermediate state counts.
    const counts = [];
    const runtime = new Interpreter(line => counts.push(Number(line)));
    for (const name of Object.keys(definitions).filter(name => name !== 'permutations')) {
        runtime.execute(`use sequences\nuse numbers\nuse io\n${definitions[name]}`);
        for (let n = 0; n <= 8; n++) {
            const value = runtime.execute(`${n} queens`);
            assert.deepEqual(value.shape, [oracle(n).solutions.length, n]);
            assert.deepEqual(rowsOf(value), oracle(n).solutions);
        }
    }
    runtime.dispose();
    const trace = new Interpreter(line => counts.push(Number(line)));
    trace.execute(`use sequences\nuse numbers\nuse io\n${definitions.prefixes.replace('for Row in 0 till N', 'for Row in 0 till N\n    States len print')}\n8 queens`);
    assert.deepEqual(counts, oracle(8).states.slice(0, 8));
    trace.dispose();
    const samples = Number(process.env.SAMPLES ?? 5);
    const variants = process.env.ONLY?.split(',') ?? Object.keys(definitions);
    const result = { node: process.version, cpu: cpus()[0].model, samples,
        method: 'Fresh process per sample, one warmup. Solve only: excludes parsing, setup, and printing. Exact ordered solutions checked against independent backtracking; prefix searches also verified for N=0..8.',
        interpreter: process.env.RANK_INTERPRETER ?? 'workspace build',
        prefixStatesByDepth: counts, definitions, solves, variants: {} };
    for (let i = 0; i < samples; i++) {
        const offset = i % variants.length;
        const order = [...variants.slice(offset), ...variants.slice(0, offset)];
        for (const name of order) {
            const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), `--worker=${name}`], { encoding: 'utf8' });
            assert.equal(child.status, 0, `${name}: ${child.stderr}`);
            (result.variants[name] ??= { runs: [] }).runs.push(JSON.parse(child.stdout).ms);
            console.error(`${name} ${i + 1}/${samples}: ${result.variants[name].runs.at(-1).toFixed(1)} ms`);
        }
    }
    for (const value of Object.values(result.variants)) value.medianMs = [...value.runs].sort((a, b) => a - b)[Math.floor(samples / 2)];
    console.log(JSON.stringify(result, null, 2));
}
