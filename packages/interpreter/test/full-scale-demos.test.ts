import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { perBallReference } from '../../../benchmarks/experiments/euler426-oracle.mjs';

it('checks the full 314_mousemoon.ra answer with borrowed real tables', () => {
    const url = new URL('../../../demos/euler/314_mousemoon.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect((runtime.variables.get('Answer') as number).toFixed(8)).toBe('132.52756426');
        expect(diagnostics.numberLoops).toBe(500);
        expect(diagnostics.numberLoopBorrowedRealCells).toBe(94501500);
        expect(diagnostics.numberLoopReadBufferCells).toBe(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.numberFunctionFallbacks).toBe(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks the full 311_biclinic.ra answer in private Number helpers', () => {
    const url = new URL('../../../demos/euler/311_biclinic.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, {sourceId: fileURLToPath(url)});
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(2466018557n);
        expect(diagnostics.numberFunctions).toBe(2500);
        expect(diagnostics.numberFunctionFallbacks).toBe(0);
    } finally { runtime.dispose(); }
}, 90_000);

// Retain full bounds and require compiled execution here.
// Fixture-level reference comparisons belong to the corpus audits.
for (const [file, expected] of [
    ['257_angularbisectors.ra', 139012411n],
    ['258_laggedfibonacci.ra', 12747994n],
    ['259_reachablenumbers.ra', 20101196798n],
    ['275_balancedsculptures.ra', 15030564n],
    ['287_quadtree.ra', 313135496n],
    ['296_angularbisector.ra', 1137208419n],
    ['299_threesimilar.ra', 549936643n],
    ['308_automaton.ra', 1539669807660924n],
    ['309_ladders.ra', 210139n],
    ['310_nimsquare.ra', 2586528661783n],
    ['426_boxball.ra', 31591886008n],
    ['468_smoothbinomial.ra', 852950321n],
    ['705_inversioncount.ra', 480440153n],
    ['714_duodigits.ra', '2.452767775565e20'],
    ['715_sextupletnorms.ra', 883188017n],
    ['719_numbersplitting.ra', 128088830547982n],
    ['720_unpredictablepermutations.ra', 688081048n],
    ['726_fallingbottles.ra', 578040951n],
    ['729_periodicrange.ra', '308896374.2502'],
    ['735_divisorsoftwo.ra', 174848216767932n],
    ['737_coinloops.ra', 757794899n],
    ['738_orderedfactorisations.ra', 143091030n],
    ['739_summationofsummations.ra', 711399016n],
    ['740_secretsanta.ra', '0.0189581208'],
    ['742_convexgridpolygon.ra', 18397727n],
    ['743_windowmatrix.ra', 259158998n],
    ['746_messydinner.ra', 867150922n],
    ['747_triangularpizza.ra', 681813395n],
    ['748_upsidedown.ra', 276402862n],
    ['749_nearpowersums.ra', 13459471903176422n],
    ['750_cardstacking.ra', 160640n],
] as const) {
    // Euler 275 can take about a minute on a busy host.
    // Euler 468 source-level verification takes about five minutes on Intel.
    const timeout = file === '468_smoothbinomial.ra' ? 360_000
        : ['715_sextupletnorms.ra', '729_periodicrange.ra', '749_nearpowersums.ra'].includes(file) ? 240_000
        : ['275_balancedsculptures.ra', '714_duodigits.ra', '719_numbersplitting.ra', '735_divisorsoftwo.ra', '737_coinloops.ra', '739_summationofsummations.ra'].includes(file) ? 120_000 : 60_000;
    it(`checks the full compiled answer for ${file}`, () => {
        const url = new URL(`../../../demos/euler/${file}`, import.meta.url);
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
        try {
            diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
            expect(runtime.variables.get('Answer')).toBe(expected);
            if (file === '426_boxball.ra') {
                expect(diagnostics.numberLoops).toBe(1);
                expect(diagnostics.numberLoopOverflows).toBe(0);
                expect(diagnostics.numberFunctionFallbacks).toBe(0);
            }
            if (file === '705_inversioncount.ra') expect(diagnostics.nativeSequenceCopies).toBeGreaterThan(0);
            if (file === '715_sextupletnorms.ra') expect(diagnostics.numberLoops).toBe(3);
            if (file === '719_numbersplitting.ra') {
                expect(diagnostics.numberTensors).toBeGreaterThan(0);
                expect(diagnostics.rankedArrayBatches).toBe(0);
            }
            if (file === '310_nimsquare.ra') expect(diagnostics.numberLoops).toBe(3);
            const nativeScan = ['720_unpredictablepermutations.ra', '726_fallingbottles.ra'].includes(file);
            if (nativeScan) {
                expect(diagnostics.modularCallbackScans).toBe(1);
            }
            if (file === '729_periodicrange.ra') expect(diagnostics.compiledTensors).toBeGreaterThan(0);
            if (file === '735_divisorsoftwo.ra') expect(diagnostics.numberTensors).toBeGreaterThan(0);
            if (file === '714_duodigits.ra') {
                expect(diagnostics.integerKeyedFolds).toBeGreaterThan(0);
                expect(diagnostics.numericUniqueSorts).toBe(18);
            }
            if (file === '737_coinloops.ra') {
                expect(diagnostics.tensorMapPreparations).toBeGreaterThan(0);
                expect(diagnostics.compiledTensors).toBeGreaterThan(0);
            }
            if (file === '740_secretsanta.ra') {
                expect(diagnostics.numberTensors).toBeGreaterThan(0);
                expect(diagnostics.tensorMapPreparations).toBe(100);
            }
            if (file === '739_summationofsummations.ra') expect(diagnostics.modularCallbackScans).toBe(48);
            if (file === '738_orderedfactorisations.ra') {
                expect(diagnostics.numberLoops).toBe(1);
                expect(diagnostics.cowCopies).toBe(0);
            }
            if (file === '749_nearpowersums.ra') expect(diagnostics.weightedAxisSums).toBeGreaterThan(0);
            if (file !== '750_cardstacking.ra' && file !== '749_nearpowersums.ra' && file !== '748_upsidedown.ra' && file !== '747_triangularpizza.ra' && file !== '746_messydinner.ra' && file !== '743_windowmatrix.ra' && file !== '742_convexgridpolygon.ra' && file !== '714_duodigits.ra' && file !== '737_coinloops.ra' && file !== '739_summationofsummations.ra' && file !== '740_secretsanta.ra' && file !== '719_numbersplitting.ra' && file !== '729_periodicrange.ra' && file !== '735_divisorsoftwo.ra' && !nativeScan) {
                expect(diagnostics.numberLoops).toBeGreaterThan(0);
            }
            if (file === '742_convexgridpolygon.ra') {
                expect(diagnostics.compiledTensors).toBeGreaterThan(0);
                expect(diagnostics.typedUnpacks).toBe(0);
            }
            if (file === '743_windowmatrix.ra') {
                expect(diagnostics.modularCallbackScans).toBe(382);
                expect(diagnostics.typedUnpacks).toBe(0);
            }
            if (file === '747_triangularpizza.ra') {
                expect(diagnostics.numberTensors).toBe(5000);
                expect(diagnostics.cellsComputed).toBe(0);
            }
            // Euler 739 already replays one speculative Number loop for
            // wide integer intermediates; the modular scans stay native.
            expect(diagnostics.numberLoopOverflows).toBe(file === '739_summationofsummations.ra' ? 1 : 0);
        } finally { runtime.dispose(); }
    }, timeout);
}

it('compiles the full Euler 255 interval traversal and preserves the exact total', () => {
    const url = new URL('../../../demos/euler/255_roundedroots.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Total')).toBe(400266100622279n);
        expect(runtime.variables.get('Count')).toBe(90000000000000n);
        expect(runtime.variables.get('Answer')).toBe(4.447401118);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks the full compiled Euler 288 tail without Number overflow', () => {
    const url = new URL('../../../demos/euler/288_enormousfactorial.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(605857431263981935n);
        expect(diagnostics.compiledLoops).toBeGreaterThanOrEqual(2);
        // The prefix rejects Number and output-only widening before the
        // broad mixed tier. The ten-million-step tail stays in Number.
        expect(diagnostics.numberLoopOverflows).toBe(2);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(3);
        expect(diagnostics.mixedIntegerLoops).toBe(2);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks the full compiled Euler 289 with private integer index stores', () => {
    const url = new URL('../../../demos/euler/289_eulerianloops.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(6567944538n);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(154);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.indexWrites).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('compiles Euler 290 row slices and keeps its large final answer exact', () => {
    const url = new URL('../../../demos/euler/290_digitalsignature.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(20444710234716473n);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(19);
        expect(diagnostics.compiledLoops).toBeGreaterThanOrEqual(19);
        // The DP cells fit Number; the final total crosses its safe range.
        expect(diagnostics.numberLoopOverflows).toBe(1);
        expect(diagnostics.bulkArrayWriteCells).toBe(1);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks the full Euler 291 polynomial sieve and compiled root preparation', () => {
    const url = new URL('../../../demos/euler/291_panaitopolprimes.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(4037526n);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(1);
        expect(diagnostics.compiledLoops).toBeGreaterThanOrEqual(3);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks full Euler 292 with disjoint slices and no operand snapshots', () => {
    const url = new URL('../../../demos/euler/292_pythagoreanpolygons.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(3600060866n);
        expect(diagnostics.numberLoops).toBe(2);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.numberLoopSliceCopies).toBe(0);
        expect(diagnostics.numberLoopSliceDirectCells).toBe(11616448);
        expect(diagnostics.cowCopies).toBe(0);
    } finally { runtime.dispose(); }
}, 60_000);

// Independent representation: match individual balls and boxes, rather than
// the Rank program's compressed stack of closing rounds.
it('cross-checks the full box-ball answer with a per-ball reference', () => {
    for (const [last, answer] of [[10, 8912], [100, 170376], [1000, 1714252], [10000000, 31591886008]])
        expect(perBallReference(last)).toBe(answer);
}, 30_000);

it('checks the full Euler 260 exact-bitset answer', () => {
    const url = new URL('../../../demos/euler/260_stonegame.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(167542057n);
        expect(diagnostics.compiledLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('compiles the full Euler 261 squarefree-table search', () => {
    const url = new URL('../../../demos/euler/261_pivotalsquare.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(238890850232021n);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(2);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 60_000);


it('compiles the full Euler 262 contour and preserves the sampled route', () => {
    const url = new URL('../../../demos/euler/262_mountainrange.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(2531.205);
        expect(runtime.variables.get('Best')).toBeCloseTo(2531.2047740264857, 8);
        expect(diagnostics.compiledLoops).toBeGreaterThanOrEqual(3);
        expect(diagnostics.fallbacks['loop:container-write-type:ForStatement']).toBeUndefined();
    } finally { runtime.dispose(); }
}, 60_000);

// The full reference input remains a manual-budget workload.
it('checks the full compiled answer for Euler 272', () => {
    const url = new URL('../../../demos/euler/272_modularcubes.ra', import.meta.url);
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(8495585919506151122n);
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('compiles the full Euler 283 reduced-divisor search with an exact wide total', () => {
    const url = new URL('../../../demos/euler/283_integertriangles.ra', import.meta.url);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(28038042525570324n);
        expect(diagnostics.compiledLoops).toBeGreaterThanOrEqual(2);
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);


it('checks the full Euler 300 maximum-contact reduction', () => {
    const url = new URL('../../../demos/euler/300_proteinfolding.ra', import.meta.url);
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        runtime.execute(readFileSync(url, 'utf8'));
        expect(runtime.variables.get('Answer')).toBe(8.0540771484375);
        expect(runtime.variables.get('Count')).toBe(3409n);
    } finally { runtime.dispose(); }
}, 60_000);


it('checks the full Euler 302 search with recursive owned-array helpers', () => {
    const url = new URL('../../../demos/euler/302_strongachilles.ra', import.meta.url);
    let calls = 0;
    const runtime = new Interpreter(() => {}, {
        sourceId: fileURLToPath(url), onScalarFunctionExecuted: () => calls++,
    });
    try {
        runtime.execute(readFileSync(url, 'utf8'));
        expect(runtime.variables.get('Answer')).toBe(1170060n);
        expect(calls).toBeGreaterThan(1_600_000);
    } finally { runtime.dispose(); }
}, 90_000);


it('checks Euler 303 with private Number state and exact wide reconstruction', () => {
    const url = new URL('../../../demos/euler/303_smalldigits.ra', import.meta.url);
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(1111981904675169n);
        expect(diagnostics.numberFunctions + diagnostics.numberFunctionSkips).toBeGreaterThanOrEqual(10000);
        expect(diagnostics.numberFunctionFallbacks).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks Euler 304 with the full prime range and array Fibonacci suffix', () => {
    const url = new URL('../../../demos/euler/304_primonacci.ra', import.meta.url);
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(283988410192n);
        expect(diagnostics.primeRunSieves).toBe(1);
        expect(diagnostics.compiledTensors).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks Euler 305 with the full reflexive-position sum', () => {
    const url = new URL('../../../demos/euler/305_reflexive.ra', import.meta.url);
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    try {
        runtime.execute(readFileSync(url, 'utf8'));
        expect(runtime.variables.get('Answer')).toBe(18174995535140n);
    } finally { runtime.dispose(); }
}, 60_000);

it('checks the full Euler 378 total with a private numeric Fenwick tree', () => {
    const url = new URL('../../../demos/euler/378_triangles.ra', import.meta.url);
    const runtime = new Interpreter(() => {}, { sourceId: fileURLToPath(url) });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(readFileSync(url, 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(147534623725724718n);
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
}, 120_000);

it('checks the full Euler 386 antichain sum with linked vector recursion', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(readFileSync(new URL('../../../demos/euler/386_antichain.ra', import.meta.url), 'utf8'));
        expect(runtime.variables.get('Answer')).toBe(528755790n);
    } finally {runtime.dispose();}
}, 30_000);

it.each([4641589, 1])('checks the full Euler 388 wide sum with bounded tables (Cut=%s)', cut => {
    const runtime = new Interpreter(() => {}, { args: [`--cut=${cut}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(readFileSync(new URL('../../../demos/euler/388_lines.ra', import.meta.url), 'utf8')));
        expect(runtime.variables.get('Answer')).toBe(831907372771451255456805129931n);
        expect(runtime.variables.get('Token')).toBe('831907372805129931');
        expect(runtime.variables.get('Top') as bigint).toBeLessThanOrEqual(100000n);
        expect(diagnostics.numberLoops).toBeGreaterThanOrEqual(3);
        // Below the cap, the small-cutoff sieve retains its bounded probe.
        expect(diagnostics.numberLoopCopyProbes).toBe(cut === 1 ? 1 : 0);
        // Wide intermediates reject both narrower speculative tiers.
        expect(diagnostics.numberLoopOverflows).toBe(2);
    } finally { runtime.dispose(); }
}, 30_000);

for (const compilation of [true, false]) it(`checks the full Euler 707 polynomial calculation (compilation=${compilation})`, () => {
    const url = new URL('../../../demos/euler/707_lightsout.ra', import.meta.url);
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(readFileSync(url, 'utf8'));
        expect(runtime.variables.get('Answer')).toBe(652907799n);
    } finally { runtime.dispose(); }
});

it('checks the full Euler 474 unit-residue count with compact row copies', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(readFileSync(new URL('../../../demos/euler/474_lastdigitsdivisors.ra', import.meta.url), 'utf8'));
        expect(runtime.variables.get('Answer')).toBe(9690646731515010n);
    } finally { runtime.dispose(); }
}, 180_000);
