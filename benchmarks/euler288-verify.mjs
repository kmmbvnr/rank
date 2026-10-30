import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';

// Build the actual integer N, then use repeated division in Legendre's formula.
// This does not use the low/tail split or the digit-sum identity of the demos.
function oracle(p, q, exp) {
    p = BigInt(p);
    let n = 0n, power = 1n, s = 290797n;
    for (let k = 0; k <= q; k++) {
        n += (s % p) * power;
        power *= p;
        s = s * s % 50515093n;
    }
    let result = 0n;
    while (n) { n /= p; result += n; }
    return result % p ** BigInt(exp);
}
const cases = [[2,0,0], [3,0,1], [61,1,10], [3,2,20], [5,9,2],
    [61,9,10], [61,10,10], [61,11,10], [61,100,10], [2,200,80],
    [7,99,0], [3,10000,20]];
let comparisons = 0;
for (const variant of ['original', 'split', 'reduced', 'shipping']) {
    const source = readFileSync(new URL(variant === 'shipping' ? '../demos/euler/288_enormousfactorial.ra' : `./experiments/euler288-${variant}.ra`, import.meta.url), 'utf8');
    for (const [p,q,exp] of cases) {
        const expected = q === 10000 ? 624955285n : oracle(p, q, exp);
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, {compilation});
            try {
                runtime.execute(source.replace('arg P integer = 61', `arg P integer = ${p}`)
                    .replace('arg Q integer = 10000000', `arg Q integer = ${q}`)
                    .replace('arg Exp integer = 10', `arg Exp integer = ${exp}`));
                assert.equal(runtime.variables.get('Answer'), expected, JSON.stringify({variant,p,q,exp,compilation}));
                comparisons++;
            } finally { runtime.dispose(); }
        }
    }
}
// Stress the research formula against BigInt remainder, including its fallback.
let remainderComparisons = 0;
function check(a, b) {
    const actual = a >= 0 && a < 2 ** 52 && b > 0 ? a - Math.floor(a / b) * b : a % b;
    assert.equal(BigInt(actual), BigInt(a) % BigInt(b), `${a} % ${b}`);
    remainderComparisons++;
}
const bounds = [0,1,2,61,50515092,50515093,2**31-1,2**31,2**52-2,2**52-1,2**52,2**52+1,Number.MAX_SAFE_INTEGER];
for (const a of bounds) for (const b of bounds.filter(x => x > 0))
    for (const signA of [-1,1]) for (const signB of [-1,1]) check(signA*a, signB*b);
let state = 123456789n;
for (let i=0; i<20000; i++) {
    state = (state*6364136223846793005n+1n) & ((1n<<64n)-1n);
    const a = Number(state % (1n<<53n));
    const b = Number((state >> 17n) % (1n<<52n)) + 1;
    check(a,b);
    const multiple = BigInt(a) / BigInt(b) * BigInt(b);
    for (const delta of [-1n,0n,1n]) {
        const n = multiple + delta;
        if (n >= 0n && n <= BigInt(Number.MAX_SAFE_INTEGER)) check(Number(n),b);
    }
}
for (let b=1n; b<10000n; b+=7n) {
    const multiple = ((1n<<52n)-1n) / b * b;
    for (const delta of [-1n,0n,1n]) check(Number(multiple+delta),Number(b));
}
// Exercise the generated loop as well, including signs and the 2^52 fallback.
const pairs = [];
for (const a of bounds) for (const b of bounds.filter(x => x > 0))
    for (const sa of [-1,1]) for (const sb of [-1,1]) pairs.push([BigInt(sa*a),BigInt(sb*b)]);
const array = (name, values) => `${name} = array shape ${values.length}\n${values.join('\n')}\nend\n`;
const expected = pairs.map(([a,b]) => { const r=a%b; return r !== 0n && (a<0n) !== (b<0n) ? r+b : r; });
const source = 'use numbers\n' + array('A',pairs.map(x=>x[0])) + array('B',pairs.map(x=>x[1]))
    + array('Expected',expected) + `Errors = 0\nfor I in 0 to ${pairs.length-1}\n  if A I mod B I not equal Expected I\n    Errors += 1\n  end\nend\n`;
const runtime = new Interpreter(()=>{}), diagnostics = new RuntimeDiagnostics();
try {
    diagnostics.run(()=>runtime.execute(source));
    assert.equal(runtime.variables.get('Errors'),0n);
    assert(diagnostics.numberLoops > 0);
    assert.equal(diagnostics.numberLoopOverflows,0);
} finally { runtime.dispose(); }
console.log(JSON.stringify({comparisons, remainderComparisons, generatedRemainders:pairs.length,
    generatedNumberLoops:diagnostics.numberLoops}));
