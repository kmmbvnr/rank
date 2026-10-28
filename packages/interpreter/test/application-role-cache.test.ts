import { expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction } from '../src/index.js';

it.each([false, true])('retries invalid alias classification and recovers (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    try {
        runtime.execute('use sequences\nfun A f op\n return A op\nend\nA = array 1 2 3');
        const fn = runtime.variables.get('f');
        if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
        const array = runtime.variables.get('A')!;
        const sum = runtime.execute('sum')!;
        const reshape = runtime.execute('reshape')!;
        expect(formatValue(fn.call([array, sum]))).toBe('6');
        for (let i = 0; i < 2; i++) {
            expect(() => fn.call([array, reshape])).toThrow('reshape expects one or more dimensions');
        }
        expect(formatValue(fn.call([array, sum]))).toBe('6');
    } finally { runtime.dispose(); }
});

it.each([false, true])('retries failed classification in one loop body (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    try {
        runtime.execute(`use sequences
A = array 1 2 3
op = sum
Errors = 0
Total = 0
for I in 1 to 5
  if I equal 2
    op = reshape
  elif I equal 5
    op = sum
  end
  try
    Value = A op
    Total += Value
  catch Err
    Errors += 1
  end
end`);
        expect(runtime.variables.get('Errors')).toBe(3n);
        expect(runtime.variables.get('Total')).toBe(12n);
    } finally { runtime.dispose(); }
});
