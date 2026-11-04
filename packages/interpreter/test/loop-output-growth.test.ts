import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const limit = 9007199254740991n;
function run(source: string, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try { return { value: diagnostics.run(() => runtime.execute(source)), diagnostics }; }
    finally { runtime.dispose(); }
}

it.each([1n, -1n])('avoids guaranteed replay for growth direction %s', sign => {
    const source = `Total = ${-sign * limit}
for I in 0 till 3
 Total += ${sign * limit}
end
Total`;
    const result = run(source);
    expect(result.value).toBe(2n * sign * limit);
    expect(result.value).toBe(run(source, false).value);
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
});

it('composes guaranteed growth across nested repetitions and both branches', () => {
    const source = `Total = 0
for I in 0 till 3
 for J in 0 till 2
  if I mod 2 equal 0
   Total -= ${limit}
  else
   Total -= ${limit - 1n}
  end
 end
end
Total`;
    const result = run(source);
    expect(result.value).toBe(-6n * limit + 2n);
    expect(result.value).toBe(run(source, false).value);
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
});

it.each([0, 1, 2])('retains safe accumulation for %s iterations', count => {
    const result = run(`Total = ${-limit}
for I in 0 till ${count}
 Total += ${limit}
end
Total`);
    expect(result.value).toBe(BigInt(count - 1) * limit);
    expect(result.diagnostics.mixedIntegerLoops).toBe(0);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
});

it.each([
    `Total = 0\n Total += ${limit}`,
    `if I mod 2 equal 0\n Total += ${limit}\n else\n Total -= ${limit}\n end`,
])('keeps resets and cancelling updates numeric: %s', body => {
    const source = `Total = 0\nfor I in 0 till 4\n ${body}\nend\nTotal`;
    const result = run(source);
    expect(result.value).toBe(run(source, false).value);
    expect(result.diagnostics.mixedIntegerLoops).toBe(0);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
});

it('retains guarded speculation when the trip count is not a source fact', () => {
    const source = `Total = 0
Count = 3
for I in 0 till Count
 Total += ${limit}
end
Total`;
    const result = run(source);
    expect(result.value).toBe(3n * limit);
    expect(result.value).toBe(run(source, false).value);
    expect(result.diagnostics.numberLoopOverflows).toBe(1);
});
