import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('block scope', () => {
    describe.each([true, false])('lexical block frames (compilation %s)', compilation => {
        it.each([
            ['I = 99', 'for I in 1 to 3\nend'],
            ['I = "keep"', 'for I in 1 to 3\nend'],
            ['I = 99', 'for Value I in array 10 20\nend'],
        ])('rejects header capture before executing a cell: %s / %s', (initial, loop) => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.execute(`${initial}\nMarker = 7`);
                const previous = runtime.variables.get('I');
                expect(() => runtime.execute(`Marker = 0\n${loop}`)).toThrow(
                    expect.objectContaining({ rankKind: 'Scope', message:
                        'I is already bound outside this block; use a different for binding name.' }),
                );
                expect(runtime.variables.get('I')).toBe(previous);
                expect(runtime.variables.get('Marker')).toBe(7n);
            } finally { runtime.dispose(); }
        });

        it('does not replace a saved error through a catch header in a later cell', () => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.execute('Saved = .NA\ntry\n .First raise\ncatch Error\n Saved = Error\nend');
                const saved = runtime.variables.get('Saved');
                expect(() => runtime.execute('try\n .Second raise\ncatch Saved\nend')).toThrow(
                    expect.objectContaining({ rankKind: 'Scope', message:
                        'Saved is already bound outside this block; use a different catch binding name.' }),
                );
                expect(runtime.variables.get('Saved')).toBe(saved);
                expect(runtime.variables.has('Error')).toBe(false);
            } finally { runtime.dispose(); }
        });

        it('keeps outer updates available through ordinary assignments', () => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                expect(runtime.execute(`Total = 0
Last = 99
for I in 1 to 3
 Total += I
 Last = I
end
if true
 Total = Total + 10
end
try
 .Oops raise
catch Error
 Total += 100
finally
 Total += 1000
end
Total`)).toBe(1116n);
                expect(runtime.variables.get('Last')).toBe(3n);
                expect(runtime.variables.has('I')).toBe(false);
                expect(runtime.variables.has('Error')).toBe(false);
            } finally { runtime.dispose(); }
        });

        it.each([
            'for R in 1 till 3\n Dy = R\n 10 f\nend',
            'if true\n Dy = 1\n 10 f\nend',
            'try\n Dy = 1\n 10 f\nfinally\n 0\nend',
            'fun Dy caller\n return 10 f\nend\n1 caller',
        ])('does not expose caller-only names: %s', body => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                expect(() => runtime.execute(`fun Q f
 return Q + Dy
end
${body}`)).toThrow('unknown name: Dy');
                expect(runtime.variables.has('Dy')).toBe(false);
                expect(runtime.execute('42')).toBe(42n);
            } finally { runtime.dispose(); }
        });

        it('rejects saving a block-local function beyond its block', () => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                expect(() => runtime.execute(`saved = len
for R in 1 till 3
 Offset = R
 fun X addOffset = X + Offset
 saved = addOffset
end
10 saved`)).toThrow('nested function addOffset cannot be returned, assigned, or stored');
                expect(runtime.variables.has('Offset')).toBe(false);
                expect(runtime.variables.has('addOffset')).toBe(false);
            } finally { runtime.dispose(); }
        });

        it('does not expose a sibling block to an enclosing local function', () => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                expect(() => runtime.execute(`fun outer
 fun Q f
  return Q + Dy
 end
 if true
  Dy = 1
  10 f
 end
 return 0
end
outer`)).toThrow('unknown name: Dy');
            } finally { runtime.dispose(); }
        });

        it('does not make a top-level block a function return context', () => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                expect(() => runtime.execute('for I in 0 till 2\n X = I\n return X\nend'))
                    .toThrow('return is only valid inside a function');
            } finally { runtime.dispose(); }
        });
    });

    it('ends a name first assigned inside a branch with that branch', () => {
        expect(() => run('if true\n Kind = "record"\nend\nKind'))
            .toThrow('Kind was assigned inside the block that ends at line 3 and does not exist after it');
        expect(() => run('if false\n Kind = 1\nelse\n Kind = 2\nend\nKind')).toThrow('does not exist after it');
        expect(run('Kind = "lower"\nif true\n Kind = "record"\nend\nKind')).toBe('record');
    });

    it('allows updating a declared option inside a loop', () => {
        expect(run('use cli\narg N integer = 8\nfor N greater 1\n N = N // 2\nend\nN')).toBe('1');
    });

    it('ends loop bindings and body names with the loop', () => {
        expect(() => run('for I in 0 to 2\n Last = I\nend\nLast')).toThrow('Last was assigned inside');
        expect(() => run('for I in 0 to 2\nend\nI')).toThrow('I was assigned inside');
        expect(() => run('I = 0\nfor I in 0 to 2\nend\nI')).toThrow('I is already bound outside this block');
        expect(run('Total = 0\nfor I in 0 to 2\n Step = I * 2\n Total += Step\nend\nTotal')).toBe('6');
    });

    it('lets a later block or statement reuse the name', () => {
        expect(run('for I in 0 to 1\nend\nfor I in 0 to 2\nend\nI = 7\nI')).toBe('7');
        expect(run('if true\n X = 1\nend\nX = "a"\nX')).toBe('a');
        expect(run('for I in 0 to 1\n X = 1\nend\nX = "a"\nX')).toBe('a');
    });

    it('keeps the type of a body name for every iteration', () => {
        expect(() => run(`fun I compute
 if I equal 0
  return 5
 end
 return array 1 2
end
for I in 0 to 1
 Res = I compute
end`)).toThrow('compute returns rank 0 and cannot return rank 1');
        expect(() => run('for I in 0 to 1\n if I equal 0\n  X = 1\n else\n  X = "a"\n end\nend'))
            .toThrow('X has type integer and cannot receive text');
    });

    it('scopes try, catch and finally separately', () => {
        expect(() => run('try\n X = 1\nfinally\n X += 1\nend')).toThrow('X was assigned inside');
        expect(() => run('use text\ntry\n "x" integer\ncatch Error\n M = 1\nend\nError')).toThrow('Error was assigned inside');
        expect(run('use text\nM = ""\ntry\n "x" integer\ncatch Error\n M = Error .Message\nend\nM len greater 0')).toBe('true');
    });

    it('rejects enclosing binding writes inside nested function blocks', () => {
        expect(() => run(`fun N outer
 Best = 0
 fun V visit
  if V greater Best
   Best = V
  end
  return Best
 end
 for I in 1 to N
  I visit
 end
 return Best
end
4 outer`)).toThrow(/Best.*enclosing/);
    });

    it.each([true, false])('removes body names at runtime with loop compilation %s', integerLoopCompilation => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation });
        try {
            runtime.execute('Total = 0\nfor I in 0 till 5\n Step = I + 1\n Total += Step\nend');
            expect(runtime.variables.get('Total')).toBe(15n);
            expect(runtime.variables.has('Step')).toBe(false);
            expect(runtime.variables.has('I')).toBe(false);
            runtime.execute('Step = "free again"');
            expect(runtime.variables.get('Step')).toBe('free again');
        } finally { runtime.dispose(); }
    });

    it('rejects reading a body name before it is assigned, so no iteration sees the previous one', () => {
        expect(() => run('for I in 0 to 2\n if I greater 0\n  Prev print\n end\n Prev = I\nend'))
            .toThrow('Prev is read before it is assigned. To keep a value between loop iterations, assign it before the loop.');
        expect(() => run('fun f\n X = X + 1\n return X\nend')).toThrow('X is read before it is assigned');
        expect(run('use io\nPrev = 0\nTotal = 0\nfor I in 0 to 2\n Total += Prev\n Prev = I\nend\nTotal')).toBe('1');
    });

    it('sees names an earlier cell left in the workspace', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('Kind = "lower"');
            expect(runtime.execute('if true\n Kind = "record"\nend\nKind')).toBe('record');
        } finally { runtime.dispose(); }
    });

    it('removes block names between separately executed cells', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('if true\n Temp = 42\nend');
            expect(runtime.variables.has('Temp')).toBe(false);
            expect(() => runtime.execute('Temp')).toThrow('unknown name: Temp');
        } finally { runtime.dispose(); }
    });

    it('uses explicit preview origin rather than a name prefix for block scope', () => {
        const source = 'if true\n RankReplPreviewCustom = 42\nend\nRankReplPreviewCustom';
        expect(() => run(source)).toThrow('RankReplPreviewCustom was assigned inside');
        const runtime = new Interpreter();
        try {
            expect(runtime.execute(source, new Set(['RankReplPreviewCustom']))).toBe(42n);
            expect(() => runtime.execute(source.replace(/Custom/g, 'Other')))
                .toThrow('RankReplPreviewOther was assigned inside');
        } finally { runtime.dispose(); }
    });
});
