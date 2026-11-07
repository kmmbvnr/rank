import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

it('discards the final loop compound RHS before an explicit return', () => {
    const source = `use sequences
fun Limit adjust
 Values = array shape Limit fill 1
 Keys = 0 till Limit copy
 for Turn in 1 to 2
  Values Keys += Values Keys * Turn
 end
 return Values
end
Result = 7 adjust`;
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect((runtime.variables.get('Result') as RankArray).items).toEqual(Array(7).fill(6n));
            if (compilation) {
                expect(diagnostics.numberLoops).toBe(1);
                expect(diagnostics.numberLoopCopyProbes).toBe(0);
            }
        } finally { runtime.dispose(); }
    }
});

it('discards a final conditional compound RHS before a tuple return', () => {
    const source = `use sequences
fun Limit tables
 Left = array shape Limit fill 1
 Right = array shape Limit fill 2
 Keys = 0 till Limit copy
 for Turn in 1 to 2
  if Turn equal 1
   Left Keys += Right Keys
  else
   Right Keys -= Left Keys
  end
 end
 return tuple Left Right
end
unpack Left Right = 5 tables`;
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect((runtime.variables.get('Left') as RankArray).items).toEqual(Array(5).fill(3n));
            expect((runtime.variables.get('Right') as RankArray).items).toEqual(Array(5).fill(-1n));
            if (compilation) expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    }
});

it('rechecks budgets and cancellation after a private prefix has warmed up', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute(`use sequences
fun Limit adjust
 Values = array shape Limit fill 1
 Keys = 0 till Limit copy
 for Turn in 1 to 2
  Values Keys += Values Keys * Turn
 end
 return Values
end
Saved = 5000 adjust`);
        expect(() => withDemandBudget(1, () => runtime.execute('Result = 5000 adjust')))
            .toThrow('demand budget exhausted');
        expect(() => withInterrupt(new Int32Array([1]), () => runtime.execute('Result = 5000 adjust')))
            .toThrow('Interrupted');
        expect(runtime.variables.has('Result')).toBe(false);
        expect((runtime.variables.get('Saved') as RankArray).items).toEqual(Array(5000).fill(6n));
    } finally { runtime.dispose(); }
});

it('still completes and checks the discarded compound operand', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute(`use sequences
fun Limit work
 Values = array shape Limit fill 1
 Zeros = array shape Limit fill 0
 Keys = 0 till Limit copy
 for Turn in 1 to 2
  Values Keys += 12 // Zeros
 end
 return 0
end
Result = 5 work`)).toThrow(/zero/);
            expect(runtime.variables.has('Result')).toBe(false);
        } finally { runtime.dispose(); }
    }
});

it('retains a completed alias while discarding the final loop result', () => {
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
fun Limit versions
 Values = array shape Limit fill 1
 Saved = Values
 Keys = 0 till Limit copy
 for Turn in 1 to 2
  Values Keys += Values Keys * Turn
 end
 return tuple Values Saved
end
unpack Current Saved = 5 versions`);
            expect((runtime.variables.get('Current') as RankArray).items).toEqual(Array(5).fill(6n));
            expect((runtime.variables.get('Saved') as RankArray).items).toEqual(Array(5).fill(1n));
        } finally { runtime.dispose(); }
    }
});
