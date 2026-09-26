import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, isRankSequence } from '../src/index.js';
import { materializedArrayItems } from '../src/array-storage.js';
import { run } from './support.js';

const rows = `
use sequences
fun rows
  yield array 1 2 3
  yield array 4 5 6
end
`;

describe('sequences of array cells', () => {
    it.each(['copy', 'array'])('stacks rows through %s for tensor addressing and transpose', operation => {
        const runtime = new Interpreter();
        runtime.execute(`${rows}\nMatrix = rows ${operation}`);
        expect(runtime.variables.get('Matrix')).toMatchObject({
            shape: [2, 3], items: [1n, 2n, 3n, 4n, 5n, 6n],
        });
        expect(runtime.execute('Matrix 1 2')).toBe(6n);
        expect(runtime.execute('Matrix transpose')).toMatchObject({
            shape: [3, 2], items: [1n, 4n, 2n, 5n, 3n, 6n],
        });
        expect(runtime.execute('Matrix sum rank 1')).toMatchObject({ items: [6n, 15n] });
    });

    it('stacks higher-rank and empty cells', () => {
        expect(run(`${rows}
fun matrices
  yield rows copy
  yield rows copy
end
matrices copy shape`)).toBe('2 2 3');
        expect(run(`use sequences
fun empty_rows
  yield array shape 0 fill 0
  yield array shape 0 fill 0
end
empty_rows copy shape`)).toBe('2 0');
        expect(run('use sequences\n(0 until 0) copy shape')).toBe('0');
    });

    it('copies each yielded cell before advancing a mutable generator', () => {
        expect(run(`use sequences
fun rows
  Row = array 1 2
  yield Row
  Row 0 = 3
  yield Row
  Row 0 = 9
end
rows copy`)).toBe('1 2 3 2');
    });

    it.each(['yield array 3', 'yield 3'])('rejects inconsistent cell shapes: %s', next => {
        expect(() => run(`use sequences
fun rows
  yield array 1 2
  ${next}
end
rows copy`)).toThrowError('materialized sequence items must have the same shape');
    });

    it('keeps streams single-pass and requires explicit copying before transpose', () => {
        const runtime = new Interpreter();
        runtime.execute(`${rows}\nRows = rows`);
        expect(isRankSequence(runtime.variables.get('Rows')!)).toBe(true);
        expect(() => runtime.execute('Rows transpose')).toThrowError('use copy to materialize the sequence');
        expect(runtime.execute('Rows copy')).toMatchObject({ shape: [2, 3] });
        expect(() => runtime.execute('Rows copy')).toThrowError('already been consumed');
    });

    it('preserves scalar and record streams and returns writable independent cells', () => {
        expect(run('use sequences\n(1 to 3) copy')).toBe('1 2 3');
        expect(run(`use sequences
fun records
  yield record
    .value = 7
  end
end
records copy shape`)).toBe('1');
        const runtime = new Interpreter();
        runtime.execute(`use sequences
Source = array 1 2
fun rows
  yield Source
end
Matrix = rows copy
Source 0 = 9
Matrix 0 1 = 8`);
        expect(runtime.variables.get('Matrix')).toMatchObject({ shape: [1, 2], items: [1n, 8n] });
        expect(runtime.variables.get('Source')).toMatchObject({ items: [9n, 2n] });
    });

    it('stops after the first row and closes the generator without demanding its tail', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line));
        runtime.execute(`use io
fun rows
  try
    yield array 1 2 3
    raise "tail demanded"
  finally
    "closed" print
  end
end
First = array 0
for Row in rows
  First = Row
  break
end`);
        expect(runtime.variables.get('First')).toMatchObject({ items: [1n, 2n, 3n] });
        expect(output).toEqual(['closed']);
    });

    it('keeps gather and XOR values lazy until their cells are demanded', () => {
        const runtime = new Interpreter();
        runtime.execute(`use bits
Key = array 101 120 112
Slots = array 0 1 2 0
Cipher = array 36 22 80 0
KeyStream = Key Slots
Plain = Cipher KeyStream bxor`);
        for (const name of ['KeyStream', 'Plain']) {
            const value = runtime.variables.get(name)!;
            expect(isRankArray(value)).toBe(true);
            if (isRankArray(value)) expect(materializedArrayItems(value)).toBeUndefined();
        }
        expect(runtime.execute('Plain sum')).toBe(308n);
    });
});
