import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(process.env.RUNTIME ?? process.cwd() + '/packages/interpreter/out/index.js'));
// node benchmarks/euler266-investigation.mjs [compiled|reference] [limit=190] [original|search|walk|shipping]
const [mode = 'compiled', limit = '190', variant = 'original'] = process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(['original','search','walk','shipping'].includes(variant));
assert(/^\d+$/.test(limit));
let s=readFileSync(new URL(variant === 'shipping' ? '../demos/euler/266_pseudosquareroot.ra' : './experiments/euler266-original.ra', import.meta.url),'utf8').replace('arg Limit integer = 190',`arg Limit integer = ${limit}`);
if(variant==='walk') s=s.slice(0,s.indexOf('Sa = A sort'))+`Sa = A sort
Sb = B sort
I = Sa len - 1
Best = 0
Prod = 0
for V in Sb
  for
    if I less 0
      break
    end
    Prod = (Sa I) * V
    if Prod at most Root
      break
    end
    I -= 1
  end
  if I less 0
    break
  end
  Best = Best max Prod
end
Answer = Best mod 10000000000000000
Answer print
`;
if(variant==='search') s=s.replace('use sequences','use sequences\nuse algo').replace(/NA = Sa len[\s\S]*?Best = Prod max/, `Where = (Sa upperindex (Root // B)) - 1
Ok = Where at least 0
Pick' = Sa (Where filter Ok array)
Mate' = B filter Ok array
Best = (Pick * Mate) max`);
const diagnostics = new RuntimeDiagnostics();
const runtime = new Interpreter(() => {}, { compilation: mode === 'compiled' });
const started = performance.now();
try {
    diagnostics.run(() => runtime.execute(s));
    if (limit === '190') {
        assert.equal(runtime.variables.get('Answer'), 1096883702440585n);
        assert.equal(runtime.variables.get('Best'), 2323218950659046189161096883702440585n);
    }
    console.log(JSON.stringify({
        mode, limit, variant, ms: performance.now() - started,
        answer: String(runtime.variables.get('Answer')),
        best: String(runtime.variables.get('Best')),
        rss: process.resourceUsage().maxRSS / 1024,
        diagnostics,
    }));
} finally {
    runtime.dispose();
}
