import { describe, expect, it, vi } from 'vitest';
import { Interpreter, isNativeFunction, type RankValue } from '../src/index.js';
import { run } from './support.js';

describe('direct infix extrema', () => {
    it('does not compile simple chains through the generator application path', () => {
        const runtime = new Interpreter();
        // Deliberately test the execution-plan boundary, not wall-clock timing.
        const slow = vi.spyOn(runtime as unknown as { compileExpression: (...args: unknown[]) => unknown }, 'compileExpression');
        expect(runtime.execute('use numbers\nA = 3\nB = 7\n(A max B min 5) + 1')).toBe(6n);
        expect(slow).not.toHaveBeenCalled();
        slow.mockRestore();
        runtime.dispose();
    });

    it('rechecks bindings and numeric types on every call', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nfun extreme A B\n return A max B min 10\nend');
        const fn = runtime.variables.get('extreme');
        if (fn === undefined || !isNativeFunction(fn)) throw new Error('missing function');
        for (const [a, b, expected] of [[1n, 3n, 3n], [4.5, 2n, 4.5], [2n ** 100n, 3n, 10n]] as RankValue[][]) {
            expect(fn.call([a, b])).toBe(expected);
        }
        runtime.dispose();
    });

    it('retains lazy broadcasting, selectors and reductions', () => {
        expect(run('use numbers\nA = array 1 8\nB = A max 3\nB')).toBe('3 8');
        expect(run('use numbers\nA = array 1 "later"\nB = A max 3\nB 0')).toBe('3');
        expect(run('use numbers\nA = array 1 8\nA 0 max 3')).toBe('3');
        expect(run('use numbers\nA = array 1 8\nA max')).toBe('8');
    });

    it('keeps effectful operands on the resumable path without replay', () => {
        expect(run(`use numbers
use algo
fun visit Log V
 Log push V
 return V
end
Log = queue
Answer = (Log 3 visit) min (Log 2 visit) max (Log 4 visit)
Log`)).toBe('3 2 4');
        expect(run(`use numbers
fun down N
 if N equal 0
  return 0
 end
 return ((N - 1) down) max N
end
10000 down`)).toBe('10000');
    });

    it('keeps error order and skipped branches', () => {
        expect(() => run('use numbers\n"bad" max 1 min Missing')).toThrow('expected number');
        expect(() => run('1 max 2')).toThrow('max requires: use numbers');
        expect(() => run('use numbers\n1 2 max')).toThrow('binary max uses infix order');
        expect(run('if false\n X = Missing max 1\nend\n7')).toBe('7');
    });
});
