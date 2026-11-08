import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';
const definition = `fun X pair
 Square = X * X
 return array X Square
end`;
it('publishes checked integer vectors from Number functions and replays wide arithmetic', () => {
    const r = new Interpreter(), d = new RuntimeDiagnostics();
    try {
        r.execute(definition);
        expect(formatValue(d.run(() => r.execute('3 pair'))!)).toBe('3 9');
        expect(d.numberFunctions).toBeGreaterThan(0);
        expect(formatValue(d.run(() => r.execute('9007199254740991 pair'))!))
            .toBe('9007199254740991 81129638414606663681390495662081');
        expect(d.numberFunctionFallbacks).toBeGreaterThan(0);
        expect(formatValue(r.execute('(-5) pair')!)).toBe('-5 25');
    } finally { r.dispose(); }
});
it('owns each published result and preserves unary vector signs', () => {
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(`fun X signed
 return array -X X
end
A = 3 signed
B = 3 signed
A 0 = 99`);
            expect(formatValue(r.variables.get('A')!)).toBe('99 3');
            expect(formatValue(r.variables.get('B')!)).toBe('-3 3');
        } finally { r.dispose(); }
    }
});
it('preserves branches and wider vector cells', () => {
    const r = new Interpreter(), d = new RuntimeDiagnostics();
    try {
        r.execute(`fun X pair
 if X less 0
  return array X 0
 end
 return array X 2147483648
end`);
        expect(formatValue(d.run(() => r.execute('2 pair'))!)).toBe('2 2147483648');
        expect(formatValue(r.execute('(-2) pair')!)).toBe('-2 0');
        expect(d.numberFunctions).toBeGreaterThan(0);
    } finally { r.dispose(); }
});
it('keeps warmed vector-result helpers on the exact budget path', () => {
    for (const budget of [1, 100, 10000]) {
        const run = (compilation: boolean) => {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(definition); r.execute('3 pair');
                try { return formatValue(withDemandBudget(budget, () => r.execute('Answer = 3 pair'))!); }
                catch (error) { return { kind: (error as Error).constructor.name, published: r.variables.has('Answer') }; }
            } finally { r.dispose(); }
        };
        expect(run(true)).toEqual(run(false));
    }
});

it('does not expose vector results through the scalar numeric-call ABI', () => {
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(definition + `
Total = 0
for I in 1 to 10
 Values = I pair
 Total += Values 1
end`);
            expect(r.variables.get('Total')).toBe(385n);
        } finally { r.dispose(); }
    }
});

it('combines a fresh helper vector with scalar arithmetic', () => {
    for (const compilation of [false, true]) {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(definition + `
fun X shifted
 Values = X pair + 3
 return Values
end`);
            expect(formatValue(r.execute('5 shifted')!)).toBe('8 28');
        } finally { r.dispose(); }
    }
});
