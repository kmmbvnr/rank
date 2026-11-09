import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankArray } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

for (const compilation of [false,true]) describe(`open ranked scalar broadcasting (${compilation})`, () => {
    function run(text: string) {
        const r=new Interpreter(()=>{}, {compilation});
        try {return formatValue(r.execute('use sequences\n'+text)!);} finally{r.dispose();}
    }
    it.each(['10 subtract N','10 subtract N rank 0 0','N subtract 10','N subtract 10 rank 0 0'])('streams %s in operand order', call => {
        const source=`fun Left subtract Right rank 0 0\n return Left - Right\nend\nN' = 1 to #\nValues' = ${call}\nValues take 4`;
        expect(run(source)).toBe(call.startsWith('N') ? '-9 -8 -7 -6' : '9 8 7 6');
    });
    it.each(['7','7.5','false'])('broadcasts primitive %s without converting its kind', fixed => {
        expect(run(`fun Left keep Right rank 0 0\n return Left\nend\nN' = 1 to #\nValues' = ${fixed} keep N\nValues take 3`)).toBe(`${fixed==='7.5'?'7.5':fixed} ${fixed==='7.5'?'7.5':fixed} ${fixed==='7.5'?'7.5':fixed}`);
    });
    it('preserves array cells and independent passes', () => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(`use sequences
fun Left pair Right
 return array Left Right
end
N' = 1 to #
Rows' = 9 pair N rank 0 0
Saved = Rows take 3`);
            const saved = r.variables.get('Saved')!;
            expect(isRankArray(saved)).toBe(true);
            if (!isRankArray(saved)) throw Error('expected array');
            expect(saved.shape).toEqual([3, 2]);
            expect(Array.from({ length: 6 }, (_, i) => readArrayItem(saved, i))).toEqual([9n, 1n, 9n, 2n, 9n, 3n]);
            const replay = r.execute('Again = Rows take 1')!;
            expect(isRankArray(replay)).toBe(true);
            if (!isRankArray(replay)) throw Error('expected array');
            expect(replay.shape).toEqual([1, 2]);
            expect([readArrayItem(replay, 0), readArrayItem(replay, 1)]).toEqual([9n, 1n]);
        } finally { r.dispose(); }
    });
    it('demands only the selected prefix, including zero demand', () => {
        let calls=0;const r=new Interpreter(()=>{}, {compilation});
        try {
            r.variables.set('seen', native('seen',1,([value])=>{calls++;if(calls>4)throw Error('overread');return value;}));
            r.execute(`use sequences\nfun Left add Right rank 0 0\n Value = Right seen\n return Left + Value\nend\nN' = 1 to #\nValues' = 10 add N`);
            r.execute('Values take 0');expect(calls).toBe(0);
            expect(r.execute('Values first where greater 13')).toBe(14n);expect(calls).toBe(4);
        } finally {r.dispose();}
    });
    it('freezes captures at plan construction', () => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(`use sequences
Shift = 1
fun Left shifted Right rank 0 0
 return Left + Right + Shift
end`);
            const plan = r.execute('10 shifted (1 to #)')!;
            r.variables.set('Saved', plan);
            r.execute('Shift = 100');
            expect(formatValue(r.execute('Saved take 2')!)).toBe('12 13');
        } finally { r.dispose(); }
    });
    it('retains whole-sequence parameter completion contracts', () => {
        const source = `fun Count prefix Values' rank 0 all
 Taken = Values take Count
 return Taken len
end
3 prefix (1 to #)`;
        expect(run(source)).toBe('3');
        expect(() => run(source.replace("Values'", 'Values'))).toThrow(/cannot materialize an infinite sequence/);
    });
    it('raises callback errors only when their cell is demanded', () => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(`use sequences
fun Left add Right rank 0 0
 if Right greater 4
  .Failure "late callback" raise
 end
 return Left + Right
end
N' = 1 to #
Values' = 10 add N`);
            expect(formatValue(r.execute('Saved = Values take 4')!)).toBe('11 12 13 14');
            expect(() => r.execute('Saved = Values take 5')).toThrow(/late callback/);
        } finally { r.dispose(); }
    });
    it('retains demand budgets and can resume a fresh pass', () => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(`use sequences
fun Left add Right rank 0 0
 return Left + Right
end
N' = 1 to #
Values' = 10 add N`);
            expect(() => withDemandBudget(4, () => r.execute('Saved = Values take 100'))).toThrow(/demand budget/);
            expect(formatValue(r.execute('Saved = Values take 2')!)).toBe('11 12');
        } finally { r.dispose(); }
    });
    it('retains cooperative cancellation after demand', () => {
        const flag=new Int32Array(new SharedArrayBuffer(4)), r=new Interpreter(()=>{}, {compilation});let calls=0;
        try {
            r.variables.set('seen',native('seen',1,([value])=>{if(++calls===5)flag[0]=1;return value;}));
            r.execute(`use sequences\nfun Left add Right rank 0 0\n Value = Right seen\n return Left + Value\nend\nN' = 1 to #\nValues' = 1 add N`);
            expect(()=>withInterrupt(flag,()=>r.execute('Taken = Values take 10000'))).toThrow(/interrupt|cancel/i);
            expect(calls).toBeGreaterThanOrEqual(5);
            expect(calls).toBeLessThan(10000);
        } finally {r.dispose();}
    });
});
