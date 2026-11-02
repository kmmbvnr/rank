import {describe,expect,it} from 'vitest';
import {Interpreter,formatValue} from '../src/index.js';
import {RankIntegerGroups} from '../src/integer-groups.js';
import {native} from '../src/modules/shared.js';

describe.each([true,false])('compiled group consumers %s',compilation => {
    it('links exact group sums, empty groups and bounds without materialization', () => {
        let calls=0;
        const runtime=new Interpreter(() => {},{compilation,onScalarFunctionExecuted:() => calls++});
        try {
            runtime.execute(`use algo
G = 3 groups
G 0 3 insert
G 0 1267650600228229401496703205376 insert
G 2 (-7) insert
fun G total K
  Total = 0
  for X in G K
    Total += X
  end
  return Total
end`);
            expect(runtime.execute('G total 0')).toBe(1267650600228229401496703205379n);
            expect(runtime.execute('G total 1')).toBe(0n);
            expect(runtime.execute('G total 2')).toBe(-7n);
            expect(() => runtime.execute('G total 3')).toThrow('groups key out of bounds');
            runtime.execute('G 0 9 insert');
            expect(runtime.execute('G total 0')).toBe(1267650600228229401496703205388n);
            if(compilation)expect(calls).toBeGreaterThan(0);
        } finally {runtime.dispose();}
    });

    it('sorts and deduplicates completed arrays without changing inputs', () => {
        let calls=0;
        const runtime=new Interpreter(() => {},{compilation,onScalarFunctionExecuted:() => calls++});
        try {
            runtime.execute(`use sequences
fun A ordered
  return A unique sort
end
fun A positions
  return A argsort
end
A = array 9007199254740993 1 9007199254740993 2`);
            expect(formatValue(runtime.execute('A ordered')!)).toBe('1 2 9007199254740993');
            expect(formatValue(runtime.execute('A positions')!)).toBe('1 3 0 2');
            expect(formatValue(runtime.execute('A')!)).toBe('9007199254740993 1 9007199254740993 2');
            expect(formatValue(runtime.execute('(array shape 0 fill 0) ordered')!)).toBe('');
            if(compilation)expect(calls).toBeGreaterThan(0);
        } finally {runtime.dispose();}
    });

    it('keeps native pipelines over groups and replacement sort observable', () => {
        const runtime=new Interpreter(() => {},{compilation});
        try {
            runtime.execute(`use algo
use sequences
G = 1 groups
G 0 7 insert
G 0 7 insert
fun G distinct K
  Total = 0
  for X in (G K) unique
    Total += X
  end
  return Total
end
fun A ordered
  return A sort
end`);
            expect(runtime.execute('G distinct 0')).toBe(7n);
            expect(formatValue(runtime.execute('(array 3 1) ordered')!)).toBe('1 3');
            runtime.variables.set('sort',native('replacement',1,() => runtime.execute('array 9')!));
            expect(formatValue(runtime.execute('(array 3 1) ordered')!)).toBe('9');
        } finally {runtime.dispose();}
    });
});

it('captures the group tail before iteration begins', () => {
    const groups=new RankIntegerGroups(1n);
    groups.insert(0n,3n);
    const values=groups.valuesAt(0n);
    groups.insert(0n,5n);
    expect([...values]).toEqual([3n]);
    expect([...groups.valuesAt(0n)]).toEqual([3n,5n]);
});
