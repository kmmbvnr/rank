import {describe,expect,it} from 'vitest';
import {Interpreter,RuntimeDiagnostics} from '../src/index.js';
import {typedArray,sharedTypedArray} from '../src/array-storage.js';

const n=262144;
const source=`use numbers
use sequences
N = ${n}
A = array shape (N + 1) fill 0
B = array shape (N + 1) fill 0
for P in V
  End = N min (524288 // P)
  for I in 1 to End
    A I += 1
  end
  for I in 1 to End
    B I += 1
  end
end`;

function execute(text: string,numberLoopCompilation=true) {
    const runtime=new Interpreter(()=>{},{numberLoopCompilation});
    const diagnostics=new RuntimeDiagnostics();
    try {
        runtime.variables.set('V',typedArray(new Int32Array([1000,2]),[2]));
        diagnostics.run(()=>runtime.execute(text));
        return {diagnostics,values:[runtime.execute('A 1'),runtime.execute(`A ${n}`),runtime.execute('B 1'),runtime.execute(`B ${n}`)]};
    } finally {runtime.dispose();}
}

describe('complete nested passes in packed vector loops',()=>{
    it.each([false,true])('amortizes copies above the probe cap (reverse=%s)',reverse=>{
        const text=reverse?source.replace('in V\n','in V reverse\n'):source;
        const result=execute(text);
        expect(result.values).toEqual(execute(text,false).values);
        expect(result.values).toEqual([2n,1n,2n,1n]);
        expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeUndefined();
    });

    it('counts a later pass after an outer continue',()=>{
        const text=source.replace('  End =',
            '  if P greater 10\n    continue\n  end\n  End =');
        const result=execute(text);
        expect(result.values).toEqual(execute(text,false).values);
        expect(result.values).toEqual([1n,1n,1n,1n]);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeUndefined();
    });

    it('does not count a later pass after a possible outer break',()=>{
        const text=source.replace('  End =','  if P greater 10\n    break\n  end\n  End =');
        const result=execute(text);
        expect(result.values).toEqual([0n,0n,0n,0n]);
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });

    it('does not reuse bounds changed by an earlier inner pass',()=>{
        const text=source.replace('    A I += 1','    A I += 1\n    End = 0');
        const result=execute(text);
        expect(result.values).toEqual(execute(text,false).values);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });

    it('keeps helper calls outside the entry work proof',()=>{
        const text='fun X identity\n  return X\nend\n'+source.replace('  End =','  Read = P identity\n  End =');
        const result=execute(text);
        expect(result.values).toEqual(execute(text,false).values);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });

    it.each([
        source.replace('1 to End', '1 to End by 2'),
        source.replace('    A I += 1', '    A I += 1\n    break'),
        source.replace('  End =', '  if P greater 10\n    continue\n  end\n  End =')
            .replace('  for I in 1 to End\n    B', '  N = 0\n  for I in 1 to End\n    B'),
    ])('retains the cap for incomplete or mutable passes',text=>{
        const result=execute(text);
        expect(result.values).toEqual(execute(text,false).values);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });

    it('preserves exact replay when an admitted pass overflows',()=>{
        const text=source.replace('    A I += 1','    A I += 9007199254740991 + I');
        const result=execute(text);
        expect(result.values).toEqual(execute(text,false).values);
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each(['array 1000','array shape 0 fill 0'])(
        'does not double count a single or empty vector (%s)',vector=>{
            const text=source.replace('N =',`V = ${vector}\nN =`);
            const result=execute(text);
            expect(result.values).toEqual(execute(text,false).values);
            expect(result.diagnostics.numberLoops).toBe(0);
        });

    it('does not inspect a vector sharing destination storage',()=>{
        const runtime=new Interpreter();
        const diagnostics=new RuntimeDiagnostics();
        const cells=new Int32Array(n+1);cells[0]=1000;cells[1]=2;
        try {
            runtime.variables.set('V',sharedTypedArray(cells.subarray(0,2),[2]));
            runtime.variables.set('A',sharedTypedArray(cells,[n+1]));
            const text=source.replace('A = array shape (N + 1) fill 0\n','');
            diagnostics.run(()=>runtime.execute(text));
            expect(runtime.execute('V 1')).toBe(2n);
            expect(diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
        } finally {runtime.dispose();}
    });
});
