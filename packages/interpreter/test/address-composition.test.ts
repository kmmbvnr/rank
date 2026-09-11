import { describe, expect, it } from 'vitest';
import { isArrayAssignmentStatement, type AddressItem } from 'rank-language';
import { completed, type Evaluation } from '../src/execution.js';
import { Interpreter, parse, type RankValue } from '../src/index.js';
import { run } from './support.js';

describe('address operand composition', () => {
    it('keeps completed selectors out of the execution stack', () => {
        const runtime = new Interpreter();
        runtime.execute('I = 1');
        const evaluator = runtime as unknown as {
            evaluateAddressItem(item: AddressItem): Evaluation<RankValue>;
        };
        for (const selector of ['I', '(I + 1)', '+I']) {
            const statement = parse(`A ${selector} = 0`).statements[0];
            if (!isArrayAssignmentStatement(statement)) throw new Error('expected assignment');
            expect(evaluator.evaluateAddressItem(statement.indices[0])).toEqual(
                completed(selector === '(I + 1)' ? 2n : 1n),
            );
        }
        runtime.dispose();
    });

    it('resumes deep selectors and values without replaying their effects', () => {
        expect(run(`use algo
fun down N
 if N equal 0
  return 0
 end
 return (N - 1) down
end
fun visit Log N
 Log push N
 return N
end
Log = queue
M = array shape 2 2 pad 0
M ((10000 down) + (Log 1 visit)) (Log 0 visit) = Log 7 visit
M 1 0 += Log 3 visit
Log`)).toBe('1 0 7 3');
    });

    it('preserves signed selectors, slices, and compound writes', () => {
        expect(run(`use ranges
M = array shape 2 2 pad 0
I = 1
M +I 0 = 3
M I 0 += 4
M 0 # = 2
M`)).toBe('2 2 7 0');
        expect(() => run('A = array 1 2\nI = 1\nA -I = 0'))
            .toThrow('array index must be nonnegative');
    });

    it('checks selectors before evaluating the right-hand side', () => {
        expect(() => run('A = array 1\nA 2 = Missing')).toThrow('array index out of bounds');
        expect(() => run('A = array 1\nA Missing = Other')).toThrow('unknown name: Missing');
    });
});
