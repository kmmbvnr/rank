import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const matrix = 'use sequences\nuse io\nM = (1 to 6) reshape 2 3\n';
describe.each([false, true])('traversal-axis loops (compilation=%s)', compilation => {
    function run(source: string) {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try { runtime.execute(source); return output; }
        finally { runtime.dispose(); }
    }
    it.each(['0', '-1'])('handles rank-1 arrays along axis %s', axis => {
        expect(run(`use io\nM = array 4 5 6\nfor V I in M axis ${axis}\n (array V I) print\nend`))
            .toEqual(['4 0', '5 1', '6 2']);
    });
    it.each(['0', '-2'])('axis %s agrees with ordinary row iteration', axis => {
        const body = '\n (array i (Row sum)) print\nend';
        expect(run(matrix + `for Row i in M axis ${axis}` + body))
            .toEqual(run(matrix + 'for Row i in M' + body));
    });
    it.each(['1', '-1'])('visits columns and their coordinates along axis %s', axis => {
        expect(run(matrix + `for Col j in M axis ${axis}\n j print\n Col print\nend`))
            .toEqual(['0', '1 4', '1', '2 5', '2', '3 6']);
    });
    it.each(['0 1', '1 0', '-1 -2'])('walks axis set %s in source order', axes => {
        expect(run(matrix + `for V i j in M axis ${axes}\n (array V i j) print\nend`))
            .toEqual(['1 0 0', '2 0 1', '3 0 2', '4 1 0', '5 1 1', '6 1 2']);
    });
    it('keeps the remaining rank-3 axes in source order', () => {
        expect(run('use sequences\nuse io\nT = (1 to 12) reshape 2 3 2\n'
            + 'for S i in T axis 1\n (S shape) print\n (S reshape 4) print\nend'))
            .toEqual(['2 2', '1 2 7 8', '2 2', '3 4 9 10', '2 2', '5 6 11 12']);
    });
    it('keeps the unselected middle axis with two coordinate bindings', () => {
        expect(run('use sequences\nuse io\nT = (1 to 12) reshape 2 3 2\n'
            + 'for S i k in T axis 2 0\n (array i k) print\n S print\nend'))
            .toEqual(['0 0', '1 3 5', '0 1', '2 4 6', '1 0', '7 9 11', '1 1', '8 10 12']);
    });
    it.each(['V', 'V i', '# i j', 'V # j', '# # #'])('supports optional indices and placeholders: %s', names => {
        expect(run(matrix + `Count = 0\nfor ${names} in M axis 0 1\n Count += 1\nend\nCount print`)).toEqual(['6']);
    });
    it('preserves value isolation and independent coordinates across continue', () => {
        expect(run(matrix + 'for Col J in M axis 1\n if J equal 1\n  continue\n end\n Col 0 = 99\n J = 99\nend\n(M reshape 6) print'))
            .toEqual(['1 2 3 4 5 6']);
    });
    it.each([['0 3', '0', []], ['0 3', '1', ['0', '0', '0']], ['2 0', '0', ['0', '0']], ['2 0', '1', []]] as const)(
        'keeps empty frames separate from empty cells (%s axis %s)', (shape, axis, output) => {
            expect(run(`use io\nM = array shape ${shape} fill 0\nfor S in M axis ${axis}\n (S len) print\nend`)).toEqual(output);
        });
    it.each(['axis 2', 'axis -3', 'axis 0 0', 'axis 1 -1', 'axis', 'axis 1.5', 'axis j', 'rank 1'])(
        'rejects invalid axes even for empty sources: %s', modifier => {
            expect(() => run(`M = array shape 0 3 fill 0\nfor V in M ${modifier}\nend`)).toThrow();
        });
    it.each(['V i j k'])('rejects extra coordinates: %s', names => {
        expect(() => run(matrix + `for ${names} in M axis 0 1\nend`)).toThrow('one index name per traversal axis');
    });
    it('rejects axes on non-arrays', () => {
        expect(() => run('for V in "abc" axis 0\nend')).toThrow('for axis expects an array');
    });
    it('demands only the first selected column before break', () => {
        expect(run(matrix + `fun X observed
 X print
 return X
end
Lazy' = M observed rank 0
for Col in Lazy axis 1
 break
end`)).toEqual(['1', '4']);
    });
    it('accepts a grouped source and ordinary axis operations', () => {
        expect(run(matrix + 'for Col in (M + 1) axis 1\n Col print\nend')).toEqual(['2 5', '3 6', '4 7']);
    });
});

describe('compiled scalar axis walks', () => {
    it.each(['0 1 2', '2 0 1', '-1 -2 -3'])('compiles coordinate order %s', axes => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter();
        try {
            expect(diagnostics.run(() => runtime.execute(`M = array shape 2 3 4 fill 1
Total = 0
for V I J K in M axis ${axes}
 Total += V + I * 100 + J * 10 + K
end
Total`))).toBe(1500n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
    it.each(['break', 'continue'])('keeps coordinates independent of writes and %s', control => {
        const source = `M = array shape 2 3 fill 1
Total = 0
for V I J in M axis 0 1
 if J equal 1
  ${control}
 end
 Total += V + I * 10 + J
 I = 99
 J = 99
end
Total`;
        const runtime = new Interpreter(), reference = new Interpreter(undefined, { compilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            expect(diagnostics.run(() => runtime.execute(source))).toEqual(reference.execute(source));
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); reference.dispose(); }
    });
    it.each(['V', 'V I', 'V # J', '# I J'])('compiles omitted indices and placeholders: %s', names => {
        const diagnostics = new RuntimeDiagnostics(), runtime = new Interpreter();
        try {
            expect(diagnostics.run(() => runtime.execute(`M = array shape 2 3 fill 1
Total = 0
for ${names} in M axis 1 0
 Total += 1
end
Total`))).toBe(6n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
    it.each([
        `for V I J in M axis 0 1
 for K in 0 till 3
  if K equal 1
   break
  end
  Total += V
 end
 if J equal 1
  break
 end
end`,
        `for K in 0 till 3
 for V I J in M axis 0 1
  if J equal 1
   break
  end
  Total += V + K
 end
end`,
        `for V I J in M axis 0 1
 for W K L in N axis 0 1
  if L equal 1
   break
  end
  Total += W
 end
 if J equal 1
  continue
 end
 Total += V
end`,
    ])('keeps break and continue scoped to the source loop: %s', loops => {
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(), reference = new Interpreter(undefined, { compilation: false });
        const source = `M = array shape 2 3 fill 1\nN = array shape 2 2 fill 2\nTotal = 0\n${loops}\nTotal`;
        try {
            expect(diagnostics.run(() => runtime.execute(source))).toEqual(reference.execute(source));
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); reference.dispose(); }
    });
    it.each(['0 3', '2 0', '2 0 4', '0 3 4', '2 3 0'])(
        'does not bind coordinates or execute bodies for empty shape %s', shape => {
            const dimensions = shape.split(' ').length;
            const axes = Array.from({ length: dimensions }, (_, i) => i).join(' ');
            const names = dimensions === 2 ? 'V I J' : 'V I J K';
            const source = `M = array shape ${shape} fill 1\nTotal = 0\nfor ${names} in M axis ${axes}\n Total += V\nend\nTotal`;
            const diagnostics = new RuntimeDiagnostics(), runtime = new Interpreter();
            try {
                expect(diagnostics.run(() => runtime.execute(source))).toBe(0n);
                expect(diagnostics.numberLoops).toBe(1);
            } finally { runtime.dispose(); }
        });
    it('rechecks dimensions when a compiled function receives another shape', () => {
        const runtime = new Interpreter(), reference = new Interpreter(undefined, { compilation: false });
        const definition = `fun M score
 Total = 0
 for V I J in M axis 0 1
  Total += V + I * 10 + J
 end
 return Total
end`;
        try {
            runtime.execute(definition);
            reference.execute(definition);
            for (const shape of ['2 3', '3 2', '0 3', '1 4']) {
                const source = `M = array shape ${shape} fill 1\nM score`;
                expect(runtime.execute(source)).toEqual(reference.execute(source));
            }
        } finally { runtime.dispose(); reference.dispose(); }
    });
    it('falls back safely on overflow and writes to the source', () => {
        for (const body of ['Total += V + 9007199254740991', 'M I J = V + 1\n Total += M I J']) {
            const source = `M = array shape 2 3 fill 1
Total = 0
for V I J in M axis 0 1
 ${body}
end
Total`;
            const runtime = new Interpreter(), reference = new Interpreter(undefined, { compilation: false });
            try { expect(runtime.execute(source)).toEqual(reference.execute(source)); }
            finally { runtime.dispose(); reference.dispose(); }
        }
    });
});
