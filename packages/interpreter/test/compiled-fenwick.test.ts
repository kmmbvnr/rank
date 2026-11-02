import {describe, expect, it} from 'vitest';
import {Interpreter, RuntimeDiagnostics, formatValue} from '../src/index.js';
import {RankFenwick} from '../src/fenwick.js';

const setup = 'use algo\nF = 8 fenwick\nAlias = F';
function observe(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, {compilation});
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(setup);
        let result: string | undefined, error: string | undefined;
        try {result = diagnostics.run(() => formatValue(runtime.execute(source)!));}
        catch (failure) {error = String(failure);}
        const cells = Array.from({length:8},(_,i) => runtime.execute(`F ${i}`));
        return {result,error,cells,total:runtime.execute('Alias sum 7'),diagnostics};
    } finally {runtime.dispose();}
}

describe('compiled exact Fenwick loops', () => {
    it.each(['=', '+=', '-=', '*=', '//=', 'mod='])('preserves %s updates, aliases and wide prefix sums', operator => {
        const source = `F 0 = 1267650600228229401496703205376
for I in 0 to 7
  F I ${operator} I + 1
  X = F I
  Y = Alias sum I
end`;
        const reference = observe(source,false), compiled = observe(source,true);
        expect({...compiled,diagnostics:undefined}).toEqual({...reference,diagnostics:undefined});
        expect(compiled.diagnostics.compiledLoops).toBeGreaterThan(0);
        expect(compiled.diagnostics.numberLoops).toBe(0);
    });

    it.each([
        'for I in 0 to 8\n  F I += I + 1\nend',
        'for I in 0 to 8\n  F I = I + 1\nend',
        'for I in 0 to 7\n  F I = I\n  X = F sum (I - 1)\n  F I //= 3 - I\nend',
        'for I in 0 till 0\n  F (-1) = 99\nend',
    ])('keeps completed stores and ordinary errors: %s', source => {
        const reference=observe(source,false),compiled=observe(source,true);
        expect({...compiled,diagnostics:undefined}).toEqual({...reference,diagnostics:undefined});
    });

    it('checks read-only aliases before destructive RHS calls', () => {
        for (const compilation of [false,true]) {
            const runtime=new Interpreter(() => {},{compilation});
            try {
                runtime.execute(setup+'\nPlan\' = F\nQ = new queue\nQ push 19');
                expect(() => runtime.execute('for I in 0 to 2\n  Alias I += Q pop\nend')).toThrow('read-only');
                expect(runtime.execute('Q len')).toBe(1n);
                expect(runtime.execute('F sum 7')).toBe(0n);
            } finally {runtime.dispose();}
        }
    });

    it('declines replaced native methods and observes each fallback call', () => {
        const runtime=new Interpreter();
        try {
            runtime.execute(setup);
            const tree=runtime.variables.get('F') as RankFenwick;
            const original=tree.sum;
            let calls=0;
            tree.sum=function(index: bigint) {calls++;return original.call(this,index)+1n;};
            expect(runtime.execute('Total = 0\nfor I in 0 to 2\n  Total += F sum I\nend\nTotal')).toBe(3n);
            expect(calls).toBe(3);
        } finally {runtime.dispose();}
    });
});
