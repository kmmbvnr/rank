import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { Interpreter, withInterrupt, RuntimeDiagnostics } = await import(process.env.RANK023_RUNTIME ?? new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const [variant = 'original', mode = 'compiled'] = process.argv.slice(2);
const source = readFileSync(new URL(variant === 'demo' ? '../demos/euler/023_abundantsums.ra' : './experiments/euler023-original.ra', import.meta.url), 'utf8').replace('arg Limit integer = 28123', 'Limit = 28123');
const boundary = source.indexOf(variant === 'demo' ? 'rem A shift' : 'rem Mark every');
const prefix = source.slice(0, boundary);
const bodies = {
    demo: source.slice(boundary),
    arrayDiscarded: source.slice(source.indexOf('rem Mark every')).replace('  Pairs (A + B) = true', '  Pairs (A + B) = true\n  Done = A'),
    nested: `Pairs = array shape (Limit + 1) fill false
for A in Abundant
 for B in Abundant
  if A + B greater Limit
   break
  end
  Pairs (A + B) = true
 end
end
Answer = (not Pairs) indices sum`,
    reduced: `use bits
Bits = (1 shl Abundant) reduce bor with 0
Pairs = (Bits shl Abundant) reduce bor with 0
N = 1 to Limit
Answer = N (not (Pairs bit N)) sum`,
    original: source.slice(source.indexOf('rem Mark every')),
    triangular: `Pairs = array shape (Limit + 1) fill false
for A in Abundant
  if A * 2 greater Limit
    break
  end
  B = Abundant (Abundant at least A)
  B = B (B at most Limit - A)
  Pairs (A + B) = true
end
Answer = (not Pairs) indices sum`,
    bitset: `use bits
Bits = 0
for A in Abundant
  Bits = Bits bor (1 shl A)
end
Pairs = 0
for A in Abundant
  Pairs = Pairs bor (Bits shl A)
end
N = 1 to Limit
Answer = N (not (Pairs bit N)) sum`,
};
const start = performance.now();
if (variant.startsWith('js-')) {
    const n = 28123, ds = new Int32Array(n + 1);
    ds.fill(1);
    ds[0] = ds[1] = 0;
    for (let d = 2; d <= n / 2; d++)
        for (let j = 2 * d; j <= n; j += d)
            ds[j] += d;
    const ab = [];
    for (let i = 12; i <= n; i++)
        if (ds[i] > i)
            ab.push(i);
    const sieve = performance.now();
    let answer = 0, writes = 0, tests = 0;
    if (variant === 'js-array') {
        const flags = new Uint8Array(n + 1);
        for (const a of ab) {
            const b = ab.filter(b => b <= n - a);
            const keys = b.map(b => a + b);
            for (const key of keys) {
                flags[key] = 1;
                writes++;
            }
        }
        for (let i = 1; i <= n; i++)
            if (!flags[i])
                answer += i;
    }
    else if (variant === 'js-any') {
        for (let i = 1; i <= n; i++) {
            let found = false;
            for (const a of ab) {
                if (a > i / 2)
                    break;
                tests++;
                if (ds[i - a] > i - a) {
                    found = true;
                    break;
                }
            }
            if (!found)
                answer += i;
        }
    }
    else {
        const flags = new Uint8Array(n + 1);
        for (let i = 0; i < ab.length; i++) {
            const a = ab[i];
            if (variant === 'js-triangular' && 2 * a > n)
                break;
            for (let j = variant === 'js-triangular' ? i : 0; j < ab.length; j++) {
                const s = a + ab[j];
                tests++;
                if (s > n) {
                    if (variant === 'js-filter')
                        continue;
                    break;
                }
                flags[s] = 1;
                writes++;
            }
        }
        for (let i = 1; i <= n; i++)
            if (!flags[i])
                answer += i;
    }
    assert.equal(answer, 4179871);
    console.log(JSON.stringify({ variant, mode, ms: performance.now() - start, sieve: sieve - start, pairs: performance.now() - sieve, tests, writes, answer, rss: process.resourceUsage().maxRSS / 1024 }));
}
else {
    const kernels = [], diag = new RuntimeDiagnostics();
    const rt = new Interpreter(() => { }, { compilation: mode !== 'reference', ...(process.env.RANK023_DIAG ? { onIntegerLoopCompiled: s => kernels.push(s) } : {}) });
    const words = new Int32Array(new SharedArrayBuffer(12));
    const signal = { length: 3, load: i => words[i], store: (i, v) => { words[i] = v; }, exchange(i, v) { const old = words[i]; words[i] = v; return old; }, wait() { throw Error('unexpected pause'); } };
    const execute = text => mode === 'mobile' ? withInterrupt(signal, () => rt.execute(text), () => { }) : rt.execute(text);
    const run = text => process.env.RANK023_DIAG ? diag.run(() => execute(text)) : execute(text);
    try {
        run(prefix);
        const sieve = performance.now();
        run(bodies[variant]);
        assert.equal((rt.variables.get('Answer') ?? rt.lastResult), 4179871n);
        console.log(JSON.stringify({ variant, mode, ms: performance.now() - start, sieve: sieve - start, pairs: performance.now() - sieve, answer: '4179871', rss: process.resourceUsage().maxRSS / 1024, ...(process.env.RANK023_DIAG ? { diag, kernels } : {}) }));
    }
    finally {
        rt.dispose();
    }
}
