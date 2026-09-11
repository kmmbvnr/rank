import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

describe('condition composition', () => {
    it('keeps Rank call conditions and skipped elif effects in order', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line));
        expect(runtime.execute(`use io
fun check N
  N print
  return N equal 2
end
if 1 check
  10
elif 2 check
  20
elif 3 check
  30
else
  40
end`)).toBe(20n);
        expect(output).toEqual(['1', '2']);
        runtime.dispose();
    });
});
