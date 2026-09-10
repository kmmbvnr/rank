import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
// An optional module path lets the same benchmark compare another checkout.
const { Interpreter } = await import(process.argv[2] ?? '../packages/interpreter/out/index.js');

// Parse once; measure repeated execution of the same function bodies.
const runtime = new Interpreter();
runtime.execute(`
use ranges
use numbers

fun tree N
  if N equal 0
    return 1
  end
  return ((N - 1) tree) + ((N - 1) tree)
end

fun total N
  Sum = 0
  for I in 0 until N
    Sum += I
  end
  return Sum
end

fun increment N
  return N + 1
end

fun calls N
  Sum = 0
  for I in 0 until N
    Sum += I increment
  end
  return Sum
end

fun nativecalls N
  Sum = 0
  for I in 0 until N
    Sum += I abs
  end
  return Sum
end

fun conditional N
  Sum = 0
  I = 0
  for I less N
    if I % 2 equal 0
      Sum += I
    end
    I += 1
  end
  return Sum
end

fun addressing N
  Values = array 1 2 3 4
  Sum = 0
  for I in 0 until N
    Sum += Values (I % 4)
  end
  return Sum
end

fun tail N
  if N equal 0
    return 0
  end
  return (N - 1) tail
end

fun add A B
  return A + B
end

fun dyadiccalls N
  Sum = 0
  for I in 0 until N
    Sum += I 1 add
  end
  return Sum
end

fun tailacc N Total
  if N equal 0
    return Total
  end
  return (N - 1) (Total + 1) tailacc
end
`);

for (const [name, arguments_, expected, warmup] of [
  ['tree', [14n], 16384n, [10n]],
  ['total', [50000n], 1249975000n, [1000n]],
  ['calls', [50000n], 1250025000n, [1000n]],
  ['nativecalls', [50000n], 1249975000n, [1000n]],
  ['conditional', [50000n], 624975000n, [1000n]],
  ['addressing', [50000n], 125000n, [1000n]],
  ['tail', [50000n], 0n, [1000n]],
  ['dyadiccalls', [50000n], 1250025000n, [1000n]],
  ['tailacc', [50000n, 0n], 50000n, [1000n, 0n]],
]) {
  const fn = runtime.variables.get(name);
  for (let i = 0; i < 2; i++) fn.call(warmup);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    assert.equal(fn.call(arguments_), expected);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(`${name}: median ${samples[2].toFixed(1)} ms (${samples.map(n => n.toFixed(1)).join(', ')})`);
}

runtime.dispose();
