// Independent small-input triangle enumeration; no solution-tree transformations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { Interpreter } = await import(pathToFileURL(resolve(
    process.argv[2] ?? 'packages/interpreter/out/index.js')));
const original = JSON.parse(readFileSync(new URL(
    '../baselines/2026-10-28-euler224-investigation.json', import.meta.url), 'utf8')).sources.original;
const shipping = readFileSync(new URL('../../demos/euler/224_almostright.ra', import.meta.url), 'utf8');
let checks = 0;
for (const limit of [...Array(31).keys(), 50, 99, 100, 101, 199, 200, 201, 300, 1000]) {
    let expected = 0;
    for (let a = 1; a <= limit / 3; a++) for (let b = a; b <= (limit - a) / 2; b++) {
        const c = Math.round(Math.sqrt(a * a + b * b + 1));
        if (c >= b && a + b + c <= limit && c * c === a * a + b * b + 1) expected++;
    }
    for (const [name, source] of Object.entries({ original, shipping })) for (const compilation of [true, false]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Limit integer = 75000000', `arg Limit integer = ${limit}`));
            assert.equal(String(runtime.variables.get('Answer')), String(expected), `${name}: ${limit}, compiled=${compilation}`);
            checks++;
        } finally { runtime.dispose(); }
    }
}
console.log(JSON.stringify({ checks }));
