import {describe,expect,it} from 'vitest';
import {Interpreter,RuntimeDiagnostics,formatValue} from '../src/index.js';
import {typedArray} from '../src/array-storage.js';

const source=`fun A weighted N
  Total = 0
  for I in 0 till A len
    Total += A I * N
  end
  return Total
end`;

describe('borrowed Int32 inputs for scalar Number kernels', () => {
    it('borrows read-only inputs, observes later writes and replays overflow exactly', () => {
        const runtime=new Interpreter();
        const diagnostics=new RuntimeDiagnostics();
        const values=typedArray(new Int32Array([1,2,3]),[3]);
        try {
            runtime.execute(source);
            runtime.variables.set('A',values);
            expect(diagnostics.run(() => runtime.execute('A weighted 7'))).toBe(42n);
            expect(diagnostics.numberFunctionArrayBorrows).toBe(1);
            expect(formatValue(runtime.execute('A')!)).toBe('1 2 3');
            runtime.execute('A 1 = 9');
            expect(runtime.execute('A weighted 7')).toBe(91n);
            expect(runtime.execute('A weighted 9007199254740991')).toBe(117093590311632883n);
            expect(formatValue(runtime.execute('A')!)).toBe('1 9 3');
            runtime.variables.set('A',typedArray(new Int32Array(0),[0]));
            expect(runtime.execute('A weighted 7')).toBe(0n);
        } finally {runtime.dispose();}
    });

    it('replays wide buffer loads and keeps parameter writes on exact paths', () => {
        const runtime=new Interpreter();
        const diagnostics=new RuntimeDiagnostics();
        try {
            runtime.execute(source);
            runtime.variables.set('A',typedArray(new BigInt64Array([9007199254740993n]),[1]));
            expect(diagnostics.run(() => runtime.execute('A weighted 3'))).toBe(27021597764222979n);
            expect(diagnostics.numberFunctionArrayBorrows).toBe(1);
            expect(diagnostics.numberFunctionFallbacks).toBe(1);
            runtime.execute(`fun A alter N
  A 0 += N
  return A 0
end`);
            runtime.variables.set('B',typedArray(new Int32Array([7]),[1]));
            expect(runtime.execute('B alter 5')).toBe(12n);
            expect(runtime.execute('B 0')).toBe(12n);
        } finally {runtime.dispose();}
    });
});
