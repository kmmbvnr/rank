import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, control, assertPatched} from '../euler374-runtime.mjs';
const id = process.argv[2] || 'small';
const file = {350: '350_constraining', 364: '364_distance', 365: '365_hugebinomial'}[id];
const source = file ? readFileSync(new URL(`../../demos/euler/${file}.ra`, import.meta.url), 'utf8')
    : `use io\nMod = ${id === 'small' ? 1009 : 982451653}\nR = 17\nfor I in 1 to 10000000\n R = (R * 37 mod Mod + I) mod Mod\nend\nR print`;
let answer;
const runtime = new Interpreter(text => { answer = text; });
const start = performance.now();
try {
    runtime.execute(source);
    const expected = {350: '84664213', 364: '44855254', 365: '162619462356610313'}[id];
    if (expected) assert.equal(answer, expected);
    assertPatched();
    console.log(JSON.stringify({id, control, answer, ms: performance.now() - start,
        rssMiB: process.resourceUsage().maxRSS / 1024}));
} finally { runtime.dispose(); }
