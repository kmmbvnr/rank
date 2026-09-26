import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('block scope', () => {
    it('ends a name first assigned inside a branch with that branch', () => {
        expect(() => run('if true\n Kind = "record"\nend\nKind'))
            .toThrow('Kind was assigned inside the block that ends at line 3 and does not exist after it');
        expect(() => run('if false\n Kind = 1\nelse\n Kind = 2\nend\nKind')).toThrow('does not exist after it');
        expect(run('Kind = "lower"\nif true\n Kind = "record"\nend\nKind')).toBe('record');
    });

    it('ends loop bindings and body names with the loop', () => {
        expect(() => run('for I in 0 to 2\n Last = I\nend\nLast')).toThrow('Last was assigned inside');
        expect(() => run('for I in 0 to 2\nend\nI')).toThrow('I was assigned inside');
        expect(run('I = 0\nfor I in 0 to 2\nend\nI')).toBe('2');
        expect(run('Total = 0\nfor I in 0 to 2\n Step = I * 2\n Total += Step\nend\nTotal')).toBe('6');
    });

    it('lets a later block or statement reuse the name', () => {
        expect(run('for I in 0 to 1\nend\nfor I in 0 to 2\nend\nI = 7\nI')).toBe('7');
        expect(run('if true\n X = 1\nend\nX = "a"\nX')).toBe('a');
        expect(run('for I in 0 to 1\n X = 1\nend\nX = "a"\nX')).toBe('a');
    });

    it('keeps the type of a body name for every iteration', () => {
        expect(() => run(`fun compute I
 if I equal 0
  return 5
 end
 return array 1 2
end
for I in 0 to 1
 Res = I compute
end`)).toThrow('Res has type integer and cannot receive array');
        expect(() => run('for I in 0 to 1\n if I equal 0\n  X = 1\n else\n  X = "a"\n end\nend'))
            .toThrow('X has type integer and cannot receive text');
    });

    it('scopes try, catch and finally separately', () => {
        expect(() => run('try\n X = 1\nfinally\n X += 1\nend')).toThrow('X was assigned inside');
        expect(() => run('use text\ntry\n "x" integer\ncatch Error\n M = 1\nend\nError')).toThrow('Error was assigned inside');
        expect(run('use text\nM = ""\ntry\n "x" integer\ncatch Error\n M = Error .Message\nend\nM len greater 0')).toBe('true');
    });

    it('lets a nested function write the enclosing names from its own blocks', () => {
        expect(run(`fun outer N
 Best = 0
 fun visit V
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
4 outer`)).toBe('4');
    });

    it.each([true, false])('removes body names at runtime with loop compilation %s', integerLoopCompilation => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation });
        try {
            runtime.execute('Total = 0\nfor I in 0 until 5\n Step = I + 1\n Total += Step\nend');
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
});
