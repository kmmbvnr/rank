import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const exclusions = JSON.parse(readFileSync(new URL('./demo-execution-exclusions.json', import.meta.url), 'utf8'));
const files = new Set(Object.keys(exclusions));
const timedOutFixtures = new Set([
    'euler/030_digitpowers_test.ra',
    'euler/562_maximalperimeter_test.ra',
]);

test('execution exclusions name existing workloads and explain the resource cost', () => {
    for (const [file, reason] of Object.entries(exclusions)) {
        assert.match(file, /^euler\/[a-z0-9_]+\.ra$/);
        assert.ok(existsSync(new URL('../demos/' + file, import.meta.url)), file);
        assert.equal(typeof reason, 'string', file);
        assert.ok(reason.length > 20, file);
    }
    assert.ok(!files.has('euler/322_binomial.ra'), 'corrected carry constraints keep the default product small');
    assert.ok(!files.has('euler/339_peredur.ra'), 'the linear expected-value recurrence stays eligible');
    assert.ok(!files.has('euler/342_totientcube.ra'), 'prime-factor residue search keeps the full bound eligible');
    assert.ok(files.has('euler/331_crossflips.ra'));
    assert.ok(!files.has('euler/393_ants.ra'), 'compiled sparse profiles keep the default 10x10 board eligible');
    assert.ok(!files.has('euler/332_sphericaltriangles.ra'), 'array geometry and sphere symmetries keep all 50 radii eligible');
});

test('recorded timeouts stay excluded while corrected compiler cases remain eligible', () => {
    for (const file of [...timedOutFixtures, 'euler/576_irrationaljumps.ra']) {
        assert.ok(files.has(file), file);
        assert.match(exclusions[file], /Exceeded the 300-second differential execution budget/, file);
    }
    for (const file of ['atcoder/edpc/10_sushi.ra', 'atcoder/edpc/10_sushi_test.ra',
        'euler/276_primitivetriangles.ra', 'euler/276_primitivetriangles_test.ra',
        'euler/477_numbersequencegame.ra', 'euler/477_numbersequencegame_test.ra']) {
        assert.ok(!files.has(file), file);
    }
});

test('new full-scale exclusions retain their small test fixtures unless they timed out', () => {
    for (const file of files) {
        const problem = Number(file.match(/^euler\/(\d+)_/)?.[1]);
        // Euler 300 belongs to the legacy 201-300 execution-budget batch.
        if (!(problem >= 301) || timedOutFixtures.has(file)) continue;
        assert.ok(!file.endsWith('_test.ra') || file.endsWith('_default_test.ra'), file);
        const fixture = file.endsWith('_default_test.ra')
            ? file.replace('_default_test.ra', '_test.ra') : file.replace(/\.ra$/, '_test.ra');
        assert.ok(existsSync(new URL('../demos/' + fixture, import.meta.url)), fixture);
        assert.ok(!files.has(fixture), fixture);
        assert.match(readFileSync(new URL('../demos/' + fixture, import.meta.url), 'utf8'), /^test /m, fixture);
    }
    assert.ok(!files.has('euler/301_nim.ra'), 'small default programs remain eligible');
});
