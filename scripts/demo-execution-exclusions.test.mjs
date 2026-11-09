import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const exclusions = JSON.parse(readFileSync(new URL('./demo-execution-exclusions.json', import.meta.url), 'utf8'));
const files = new Set(Object.keys(exclusions));
const timedOutFixtures = new Set([
    'euler/030_digitpowers_test.ra',
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
    assert.ok(!files.has('euler/428_necklacetriplets.ra'), 'fused quotient statistics keep the full default eligible');
    assert.ok(!files.has('euler/429_unitary.ra'), 'native modular arrays keep the full factorial bound eligible');
    assert.ok(!files.has('euler/432_totientsum.ra'), 'private sieve and modular prefixes keep the full totient sum eligible');
    assert.ok(!files.has('euler/451_modularinverses.ra'), 'private array stages keep the full modular root search eligible');
    assert.ok(!files.has('euler/452_longproducts.ra'), 'multiplicative factor counts keep the full long-product sum eligible');
    assert.ok(!files.has('euler/454_diophantinereciprocals.ra'), 'quotient groups and private reducers keep the full reciprocal count eligible');
    assert.ok(!files.has('euler/465_polarpolygons.ra'), 'modular totient tables keep the full polar-polygon input eligible');
    assert.ok(!files.has('euler/466_distinctproducts.ra'), 'memoized blocker sets keep the full multiplication table eligible');
    assert.ok(!files.has('euler/470_superramvok.ra'), 'subset-mask statistics keep the full Super Ramvok input eligible');
    assert.ok(!files.has('euler/476_circlepacking.ra'), 'fused real helpers and native real-kind scans keep the full circle average eligible');
    assert.ok(files.has('euler/331_crossflips.ra'));
    assert.ok(!files.has('euler/393_ants.ra'), 'compiled sparse profiles keep the default 10x10 board eligible');
    assert.ok(!files.has('euler/332_sphericaltriangles.ra'), 'array geometry and sphere symmetries keep all 50 radii eligible');
});

test('recorded timeouts stay excluded while corrected compiler cases remain eligible', () => {
    for (const file of timedOutFixtures) {
        assert.ok(files.has(file), file);
        assert.match(exclusions[file], /Exceeded the 300-second differential execution budget/, file);
    }
    for (const file of ['atcoder/edpc/10_sushi.ra', 'atcoder/edpc/10_sushi_test.ra',
        'euler/276_primitivetriangles.ra', 'euler/276_primitivetriangles_test.ra',
        'euler/576_irrationaljumps.ra',
        'euler/562_maximalperimeter.ra', 'euler/562_maximalperimeter_test.ra',
        'euler/563_robotwelders.ra', 'euler/563_robotwelders_test.ra',
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
    assert.ok(!files.has('euler/487_sumsofpowersums.ra'), 'linear scalar-modulus scans keep the full power-sum input eligible');
    assert.ok(!files.has('euler/489_commonfactors.ra'), 'compiled finite-array helpers keep the full common-factor search eligible');
    assert.ok(!files.has('euler/495_distinctproduct.ra'), 'modular axis scans keep the full distinct-factor count eligible');
    assert.ok(!files.has('euler/485_maxdivisors.ra'), 'bounded independent divisor blocks keep the full window sum eligible');
    assert.ok(!files.has('euler/484_arithmeticderivative.ra'), 'stored powerful stages keep the full derivative sum eligible');
    assert.ok(!files.has('euler/483_repeatedpermutation.ra'), 'batched cycle transitions keep the full permutation mean eligible');
    assert.ok(!files.has('euler/482_incenter.ra'), 'exact geometric windows keep the full incenter sum eligible');
    assert.ok(!files.has('euler/478_mixtures.ra'), 'bounded exponent residues keep the full mixture count eligible');
    assert.ok(!files.has('euler/318_nines.ra'), 'bounded pair search keeps the full real-log workload eligible');
    assert.ok(!files.has('euler/324_tower.ra'), 'certified period reduction keeps the full tower workload eligible');
    assert.ok(!files.has('euler/372_pencils.ra'), 'exact continued fractions keep the full ray count eligible');
    assert.ok(!files.has('euler/373_circles.ra'), 'multiplicative divisor weights keep the full circle sum eligible');
    assert.ok(!files.has('euler/341_golomb.ra'), 'Golomb runs keep the full cube sum eligible');
    assert.ok(!files.has('euler/341_golomb_default_test.ra'), 'the millionth-term recurrence stays eligible');
    assert.ok(!files.has('euler/301_nim.ra'), 'small default programs remain eligible');
});

test('Euler 468 retains explicit full-scale and ordinary fixture lanes', () => {
    assert.match(exclusions['euler/468_smoothbinomial.ra'], /Full-scale lane/);
    assert.ok(!files.has('euler/468_smoothbinomial_test.ra'));
    const full = readFileSync(new URL('../packages/interpreter/test/full-scale-demos.test.ts', import.meta.url), 'utf8');
    assert.ok(full.includes("['468_smoothbinomial.ra', 852950321n]"));
});

test('Euler 474 retains full-scale verification and its ordinary fixture', () => {
    assert.match(exclusions['euler/474_lastdigitsdivisors.ra'], /Full-scale lane/);
    assert.ok(!files.has('euler/474_lastdigitsdivisors_test.ra'));
    const full = readFileSync(new URL('../packages/interpreter/test/full-scale-demos.test.ts', import.meta.url), 'utf8');
    assert.ok(full.includes('checks the full Euler 474 unit-residue count with compact row copies'));
    assert.ok(full.includes('9690646731515010n'));
});
