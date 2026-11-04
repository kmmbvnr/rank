import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Interpreter, RankError, RuntimeDiagnostics, formatValue, type RankSequence, type NativeFunction, type RankValue} from '../src/index.js';
import {densePrimePlan} from '../src/dense-prime-sieve.js';
import {metadataBoundLength, registerMetadataBounds} from '../src/sequence-bounds.js';
import {withDemandBudget, withInterrupt} from '../src/interrupt.js';

function observe(source: string, compilation: boolean) {
    let calls = 0;
    const r = new Interpreter(() => {}, {compilation, onScalarFunctionExecuted: () => calls++});
    try {
        let result: string | undefined, error: string | undefined;
        try {result = formatValue(r.execute('use numbers\nuse sequences\n' + source)!);}
        catch (failure) {error = failure instanceof RankError ? failure.format() : String(failure);}
        return {result, error, calls};
    } finally {r.dispose();}
}
function compare(source: string) {
    const reference = observe(source, false), compiled = observe(source, true);
    expect({...compiled, calls: 0}).toEqual({...reference, calls: 0});
    return compiled;
}
const prefix = `use sequences
Sieve = 100000 primesieve
fun Top prefix
 return (Sieve to Top) len
end
fun Top before
 return (Sieve till Top) len
end`;

describe('linked scalar array concat and bounded lengths', () => {
    it.each(['', ' copy'])('compiles recursive vector extensions with completion %j', completion => {
        const result = compare(`fun A tally N
 if N equal 0
  return A len
 end
 B = concat A (array N)${completion}
 M = N - 1
 return B tally M
end
A = array 7 11
A tally 20`);
        expect(result.result).toBe('22');
        expect(result.calls).toBeGreaterThan(1);
    });

    it.each(['9007199254740993', '1.5', 'true', '"😀"'])('copies vectors and empty inputs containing %s', item => {
        const result = compare(`fun A append B
 V = concat A B copy
 return V
end
A = array shape 0 fill ${item}
B = array ${item} ${item}
(A append B) copy`);
        expect(result.error).toBeUndefined();
        expect(result.calls).toBe(1);
    });

    it.each(['', ' copy'])('preserves concat snapshots with completion %j', completion => {
        const result = compare(`fun A append B
 return concat A B${completion}
end
A = array 1 2
B = array 3 4
V = A append B
A 0 = 99
B 0 = 88
V copy`);
        expect(result.result).toBe('1 2 3 4');
        expect(result.calls).toBe(1);
    });

    it('keeps parameter-write protection and argument value semantics', () => {
        compare(`fun A append B
 V = concat A B copy
 A 0 = 99
 return V
end
A = array 1 2
B = array 3 4
V = A append B
concat A V copy`);
    });

    it.each(['concat A B copy', 'concat A B axis 0 copy'])('keeps mixed-element/axis forms in ordinary dispatch: %s', body => {
        expect(compare(`fun A append B
 return ${body}
end
A = array 1 2
B = array "x"
A append B`).error).toContain('one element type');
    });

    it('retains errors after completing a concat', () => {
        expect(compare(`fun A append N
 B = concat A (array N) copy
 return B 100
end
A = array 1 2
A append 3`).error).toContain('out of bounds');
    });

    it('guards a warmed copy builtin', () => {
        const r = new Interpreter();
        try {
            r.execute(`use sequences
fun A append B
 V = concat A B copy
 return V len
end
A = array 1 2
B = array 3`);
            expect(r.execute('A append B')).toBe(3n);
            r.execute('original = copy');
            const fn = r.variables.get('original') as NativeFunction;
            const original = fn.call;
            let reads = 0;
            try {
                Reflect.set(fn, 'call', (args: RankValue[]) => {reads++; return original(args);});
                expect(r.execute('A append B')).toBe(3n);
                expect(reads).toBe(1);
            } finally {Reflect.set(fn, 'call', original);}
        } finally {r.dispose();}
    });

    it.each([false, true])('matches inclusive/exclusive endpoints, compiled=%s', compilation => {
        let calls = 0;
        const r = new Interpreter(() => {}, {compilation, onScalarFunctionExecuted: () => calls++});
        try {
            r.execute(prefix);
            const plan = (r.variables.get('Sieve') as RankSequence).plan;
            for (const n of [-10000000000000000000000000n, -1n, 0n, 1n, 2n, 3n, 17n, 4095n, 4096n, 4097n, 99991n, 100000n, 100001n, 10000000000000000000000000n]) {
                expect(r.execute(`${n} prefix`)).toBe(plan.withUpperBound!(n, true).length!());
                expect(r.execute(`${n} before`)).toBe(plan.withUpperBound!(n, false).length!());
            }
            if (compilation) expect(calls).toBe(28);
        } finally {r.dispose();}
    });

    it('reads replacement captures on a warmed helper', () => {
        const r = new Interpreter();
        try {
            r.execute(prefix);
            expect(r.execute('100 prefix')).toBe(25n);
            r.execute('Sieve = 10 primesieve');
            expect(r.execute('100 prefix')).toBe(4n);
            r.execute('Sieve = 0 primesieve');
            expect(r.execute('100 prefix')).toBe(0n);
        } finally {r.dispose();}
    });

    it('keeps custom sequences and unused captures observable', () => {
        const r = new Interpreter();
        try {
            r.execute(prefix);
            expect(r.execute('100 prefix')).toBe(25n);
            const plan = (r.variables.get('Sieve') as RankSequence).plan;
            let reads = 0;
            r.variables.set('Sieve', {kind: 'sequence', plan: {...plan, withUpperBound(n, inclusive) {
                reads++;
                return plan.withUpperBound!(n, inclusive);
            }}});
            expect(r.execute('100 prefix')).toBe(25n);
            expect(reads).toBe(1);
            r.execute(`fun N chooseprefix
 if N less 0
  return 7
 end
 return (Unknown to N) len
end`);
            expect(r.execute('(-1) chooseprefix')).toBe(7n);
            expect(() => r.execute('10 chooseprefix')).toThrow('Unknown');
        } finally {r.dispose();}
    });

    it('does not add opaque plan-header reads during entry probing', () => {
        const reads: number[] = [];
        for (const compilation of [false, true]) {
            const r = new Interpreter(() => {}, {compilation});
            try {
                r.execute(prefix);
                const plan = (r.variables.get('Sieve') as RankSequence).plan;
                let count = 0;
                r.variables.set('Sieve', {kind: 'sequence', get plan() {count++; return plan;}});
                expect(r.execute('100 prefix')).toBe(25n);
                reads.push(count);
            } finally {r.dispose();}
        }
        expect(reads[1]).toBe(reads[0]);
    });

    it('respects existing native bounds', () => {
        const r = new Interpreter();
        try {
            r.execute(prefix + '\nSieve = Sieve from 11 till 31');
            expect(r.execute('100 prefix')).toBe(6n);
            expect(r.execute('23 prefix')).toBe(5n);
            expect(r.execute('11 before')).toBe(0n);
            expect(r.execute('11 prefix')).toBe(1n);
        } finally {r.dispose();}
    });

    it('declines a direct reader after method replacement', () => {
        const source = densePrimePlan(100n), clone = {...source};
        registerMetadataBounds(clone, () => 123n);
        expect(metadataBoundLength(clone)?.(50n, true)).toBe(123n);
        clone.length = () => 999n;
        expect(metadataBoundLength(clone)).toBeUndefined();
        const clone2 = {...source};
        registerMetadataBounds(clone2, () => 123n);
        clone2.withUpperBound = () => source;
        expect(metadataBoundLength(clone2)).toBeUndefined();
    });

    it.each([false, true])('keeps cancellation and finally in index preparation, compiled=%s', compilation => {
        const r = new Interpreter(() => {}, {compilation}), flag = new Int32Array(1);
        try {
            r.execute(prefix + '\nSieve = 10000000 primesieve\nDone = 0');
            flag[0] = 1;
            expect(() => withInterrupt(flag, () => r.execute(`try
 10000000 prefix
finally
 Done = 1
end`))).toThrow('Interrupted');
            expect(r.variables.get('Done')).toBe(1n);
            flag[0] = 0;
            expect(r.execute('100 prefix')).toBe(25n);
        } finally {r.dispose();}
    });

    it('keeps a warmed helper checked under a demand budget', () => {
        const r = new Interpreter();
        try {
            r.execute(prefix);
            expect(r.execute('100 prefix')).toBe(25n);
            expect(() => withDemandBudget(10, () => r.execute(`for I in 1 to 1000
 I prefix
end`))).toThrow();
            expect(r.execute('100 prefix')).toBe(25n);
        } finally {r.dispose();}
    });

    it('compiles the Euler 386 recursive count with the known million-limit answer', () => {
        const source = readFileSync(new URL('../../../demos/euler/386_antichain.ra', import.meta.url), 'utf8');
        const d = new RuntimeDiagnostics(), r = new Interpreter(() => {}, {args: ['--limit=1000000']});
        try {
            d.run(() => r.execute(source));
            expect(r.variables.get('Answer')).toBe(4153927n);
            expect(d.compilerRejections.some(rejection => rejection.function === 'cnt'
                && rejection.reason !== 'scalar-function:callee-binding:ApplicationExpression')).toBe(false);
            expect(d.numberLoopOverflows).toBe(0);
        } finally {r.dispose();}
    });
});
