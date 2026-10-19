import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const exclusions = JSON.parse(readFileSync(new URL('./demo-execution-exclusions.json', import.meta.url), 'utf8'));
const files = new Set(Object.keys(exclusions));

test('execution exclusions name existing workloads and explain the resource cost', () => {
    for (const [file, reason] of Object.entries(exclusions)) {
        assert.match(file, /^euler\/[a-z0-9_]+\.ra$/);
        assert.ok(existsSync(new URL('../demos/' + file, import.meta.url)), file);
        assert.equal(typeof reason, 'string', file);
        assert.ok(reason.length > 20, file);
    }
    assert.ok(files.has('euler/322_binomial.ra'));
    assert.ok(files.has('euler/331_crossflips.ra'));
});

test('new full-scale exclusions retain their small test fixtures', () => {
    for (const file of files) {
        if (!/^euler\/3\d\d_/.test(file)) continue;
        assert.ok(!file.endsWith('_test.ra'), file);
        const fixture = file.replace(/\.ra$/, '_test.ra');
        assert.ok(existsSync(new URL('../demos/' + fixture, import.meta.url)), fixture);
        assert.ok(!files.has(fixture), fixture);
    }
    assert.ok(!files.has('euler/301_nim.ra'), 'small default programs remain eligible');
});
