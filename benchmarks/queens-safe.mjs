import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Interpreter, parse } from '../packages/interpreter/out/index.js';

// npx tsc -b tsconfig.build.json && node benchmarks/queens-safe.mjs
// Optional: SAMPLES=1 for screening, ONLY=unique,scalar for a subset.
const definitions = {
    unique: `fun Q safe rank 1
  Up = Q + Columns unique len
  if Up not equal 8
    return false
  end
  return Q - Columns unique len equal 8
end`,
    'adjacent-unique': `fun Q safe rank 1
  for I in 0 till 7
    if (Q I - Q (I + 1)) abs equal 1
      return false
    end
  end
  Up = Q + Columns unique len
  if Up not equal 8
    return false
  end
  return Q - Columns unique len equal 8
end`,
    'outer-count': `Dy = Columns Columns outer - abs copy
fun Q safe rank 1
  Dx = Q Q outer - abs
  return (Dx equal Dy) count equal 8
end`,
    'outer-any': `Dy = Columns Columns outer - abs copy
Different = Dy greater 0 copy
fun Q safe rank 1
  Dx = Q Q outer - abs
  Hit = Dx equal Dy and Different
  return not (Hit any)
end`,
    pairs: `Pairs = Columns 2 combinations array
I = Pairs # 0 copy
J = Pairs # 1 copy
Distances = J - I copy
fun Q safe rank 1
  Dx = (Q I - Q J) abs
  return (Dx not equal Distances) all
end`,
    shifts: `fun Q safe rank 1
  for D in 1 till 8
    Left = Q (0 till (8 - D) array)
    Right = Q (D till 8 array)
    if ((Left - Right) abs equal D) any
      return false
    end
  end
  return true
end`,
    'shifts-hoisted': `LeftIndices = tuple ${Array.from({ length: 7 }, (_, i) => `(0 till ${7 - i} array)`).join(' ')}
RightIndices = tuple ${Array.from({ length: 7 }, (_, i) => `(${i + 1} till 8 array)`).join(' ')}
fun Q safe rank 1
  for D in 1 till 8
    Left = Q (LeftIndices (D - 1))
    Right = Q (RightIndices (D - 1))
    if ((Left - Right) abs equal D) any
      return false
    end
  end
  return true
end`,
    rank: `Offsets = (array -1 1) Columns outer * copy
fun A distinct rank 1
  return A unique len equal 8
end
fun Q safe rank 1
  Diags = Offsets + Q
  return Diags distinct rank 1 all
end`,
    scalar: `fun Q safe rank 1
  for I in 0 till 7
    for J in I + 1 till 8
      if (Q I - Q J) abs equal J - I
        return false
      end
    end
  end
  return true
end`,
    'scalar-distance': `fun Q safe rank 1
  for D in 1 till 8
    for I in 0 till (8 - D)
      if (Q I - Q (I + D)) abs equal D
        return false
      end
    end
  end
  return true
end`,
    'scalar-signed': `fun Q safe rank 1
  for D in 1 till 8
    for I in 0 till (8 - D)
      Delta = Q I - Q (I + D)
      if Delta equal D or Delta equal -D
        return false
      end
    end
  end
  return true
end`,
};

function oracle() {
    const accepted = [];
    let checked = 0;
    function visit(row) {
        if (row.length === 8) {
            checked++;
            if (row.every((col, i) => row.slice(i + 1).every((other, offset) => Math.abs(col - other) !== offset + 1))) accepted.push(row.join(','));
            return;
        }
        for (let col = 0; col < 8; col++) if (!row.includes(col)) visit([...row, col]);
    }
    visit([]);
    assert.equal(checked, 40320);
    assert.equal(accepted.length, 92);
    return accepted;
}

const variant = process.argv.find(arg => arg.startsWith('--worker='))?.slice(9);
if (variant) {
    assert(variant in definitions);
    const setup = parse(`use algo\nuse sequences\nuse numbers\nColumns = 0 till 8 array\n${definitions[variant]}`);
    const solve = parse('Candidates = Columns permutations\nValid = Candidates filter safe\nSolutions = Valid copy');
    const expected = oracle();
    const run = () => {
        const runtime = new Interpreter(() => {});
        runtime.executeProgram(setup);
        global.gc();
        const start = performance.now();
        runtime.executeProgram(solve);
        const ms = performance.now() - start;
        const solutions = runtime.variables.get('Solutions');
        assert.deepEqual(solutions.shape, [92, 8]);
        const rows = Array.from({ length: 92 }, (_, r) => Array.from({ length: 8 }, (_, c) =>
            String(solutions.itemAt?.(r * 8 + c) ?? solutions.items[r * 8 + c])).join(','));
        assert.deepEqual(rows, expected);
        runtime.dispose();
        return ms;
    };
    run();
    console.log(JSON.stringify({ ms: run() }));
} else {
    const samples = Number(process.env.SAMPLES ?? 5);
    const variants = process.env.ONLY?.split(',') ?? Object.keys(definitions);
    const result = { node: process.version, cpu: cpus()[0].model, samples,
        method: 'Fresh process per sample, one warmup; solve includes lazy permutation generation, filtering and copying solutions; excludes parsing, setup and board output. Every run must exactly match an independent exhaustive oracle over all 40320 permutations.',
        definitions, variants: {} };
    // Rotate variant order across samples so later variants do not always run last.
    for (let i = 0; i < samples; i++) {
        const order = [...variants.slice(i % variants.length), ...variants.slice(0, i % variants.length)];
        for (const name of order) {
            const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), `--worker=${name}`], { encoding: 'utf8' });
            assert.equal(child.status, 0, `${name}: ${child.stderr}`);
            (result.variants[name] ??= { runs: [] }).runs.push(JSON.parse(child.stdout).ms);
            console.error(`${name} ${i + 1}/${samples}: ${result.variants[name].runs.at(-1).toFixed(1)} ms`);
        }
    }
    for (const variant of Object.values(result.variants)) variant.medianMs = [...variant.runs].sort((a, b) => a - b)[Math.floor(samples / 2)];
    console.log(JSON.stringify(result, null, 2));
}
