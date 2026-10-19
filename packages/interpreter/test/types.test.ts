import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeBindings, analyzeValues } from '@arrrank/language';
import { Interpreter, isRankArray, parse, typeName } from '../src/index.js';

const demos = fileURLToPath(new URL('../../../demos', import.meta.url));
// These run a minute or more with their real input (issues #316, #333, #338);
// their tests use small inputs.
const tooSlow = new Set([
    'euler/154_pascalpyramid.ra',
    'euler/210_obtuse.ra',
    'euler/224_almostright.ra',
    'euler/250_subsets.ra',
    'euler/250_subsets_test.ra',
    'euler/266_pseudosquareroot.ra',
    'euler/268_fourprimes.ra',
    'euler/211_divisorsquare.ra',
    'euler/212_combinedvolume.ra',
    'euler/213_fleacircus.ra',
    'euler/214_totientchains.ra',
    'euler/216_primality.ra',
    'euler/223_almostright.ra',
    'euler/229_foursquares.ra',
    'euler/236_luxuryhampers.ra',
    'euler/238_infinitestring.ra',
    'euler/245_coresilience.ra',
    'euler/248_eulertotient.ra',
    'euler/249_primesubsetsums.ra',
    'euler/251_cardanotriplets.ra',
    'euler/253_tidyingup.ra',
    'euler/254_digitfactorials.ra',
    'euler/260_stonegame.ra',
    'euler/262_mountainrange.ra',
    'euler/272_modularcubes.ra',
    'euler/275_balancedsculptures.ra',
    'euler/283_integertriangles.ra',
    'euler/289_eulerianloops.ra',
    'euler/291_panaitopolprimes.ra',
    'euler/292_pythagoreanpolygons.ra',
    'euler/295_lenticularholes.ra',
    'euler/300_proteinfolding.ra',
    'euler/229_foursquares_test.ra',
    'euler/236_luxuryhampers_test.ra',
    'euler/238_infinitestring_test.ra',
    'euler/245_coresilience_test.ra',
    'euler/251_cardanotriplets_test.ra',
    'euler/254_digitfactorials_test.ra',
    'euler/260_stonegame_test.ra',
    'euler/283_integertriangles_test.ra',
    'euler/289_eulerianloops_test.ra',
    'euler/291_panaitopolprimes_test.ra',
    'euler/295_lenticularholes_test.ra',
]);

function programs(): string[] {
    const files: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.ra') && !tooSlow.has(path.relative(demos, full))) files.push(full);
        }
    };
    walk(demos);
    return files.sort();
}

/**
 * The rule that makes static types worth showing: the analyzer may say nothing,
 * but it may never say something false. Every demo that runs without a host —
 * no standard input, no files, no database — is checked name by name against
 * the values its run actually produced.
 */
interface Audit {
    readonly contradictions: string[];
    readonly ran: number;
    readonly names: number;
    readonly settled: number;
}

function audit(file: string): Audit {
    const contradictions: string[] = [];
    const unobserved = { contradictions, ran: 0, names: 0, settled: 0 };
    const source = fs.readFileSync(file, 'utf8');
    let facts;
    try {
        facts = analyzeBindings(parse(source, file));
    } catch {
        return unobserved; // `rank check` owns parse failures.
    }
    const interpreter = new Interpreter(() => undefined, { sourceId: file, testing: true });
    try {
        interpreter.execute(source);
    } catch {
        return unobserved; // A program that needs a host cannot be observed here.
    } finally {
        interpreter.dispose();
    }

    const values = analyzeValues(parse(source, file));
    for (const diagnostic of values.diagnostics) {
        contradictions.push(`${path.relative(demos, file)}: false diagnostic: ${diagnostic.message}`);
    }
    for (const [name, fact] of values.bindings) {
        const value = interpreter.variables.get(name);
        if (value === undefined) continue;
        if (fact.types.length && !fact.types.includes(typeName(value))) {
            contradictions.push(`${path.relative(demos, file)} ${name}: value analysis inferred ${fact.types.join(' or ')}, ran as ${typeName(value)}`);
        }
        if (isRankArray(value)) {
            if (fact.rank !== undefined && fact.rank !== value.shape.length) {
                contradictions.push(`${path.relative(demos, file)} ${name}: inferred rank ${fact.rank}, ran as ${value.shape.length}`);
            }
            if (fact.shape?.some((dimension, axis) => dimension !== null && dimension !== value.shape[axis])) {
                contradictions.push(`${path.relative(demos, file)} ${name}: inferred shape ${fact.shape}, ran as ${value.shape}`);
            }
        }
    }

    let names = 0, settled = 0;
    const program = facts.scopes.find(scope => scope.kind === 'program')!;
    for (const binding of program.bindings) {
        const value = interpreter.variables.get(binding.name);
        if (value === undefined) continue;
        names += 1;
        if (binding.types.length === 0) continue;
        settled += 1;
        const actual = typeName(value);
        if (!binding.types.includes(actual)) {
            contradictions.push(`${path.relative(demos, file)} ${binding.name}: `
                + `inferred ${binding.types.join(' or ')}, ran as ${actual}`);
        }
    }
    return { contradictions, ran: 1, names, settled };
}

describe('inferred types against the values a run produced', () => {
    const shardCount = Number(process.env.RANK_TYPE_AUDIT_SHARDS ?? 1);
    const shard = Number(process.env.RANK_TYPE_AUDIT_SHARD ?? 0);
    if (!Number.isInteger(shardCount) || shardCount < 1 || !Number.isInteger(shard) || shard < 0 || shard >= shardCount) {
        throw new Error('Invalid type audit shard');
    }
    const files = programs().filter(file =>
        createHash('sha256').update(path.relative(demos, file)).digest().readUInt32BE(0) % shardCount === shard);
    const results = new Map<string, Audit>();
    for (const file of files) {
        it(path.relative(demos, file), async context => {
            const result = audit(file);
            results.set(file, result);
            // Process worker messages and deadlines after each CPU-bound demo.
            await setImmediate();
            if (!result.ran) context.skip();
            expect(result.contradictions).toEqual([]);
        // Bound each program, rather than giving the growing corpus one deadline.
        }, 300_000);
    }

    afterAll(() => {
        // A name-filtered run checks its selected programs. Full runs also keep
        // the original corpus-wide coverage gate; individual failures still fail.
        if (results.size !== files.length) return;
        const totals = [...results.values()].reduce((sum, result) => ({
            ran: sum.ran + result.ran, names: sum.names + result.names, settled: sum.settled + result.settled,
        }), { ran: 0, names: 0, settled: 0 });
        console.log(`type audit: ${totals.ran} demos run, ${totals.names} names, ${totals.settled} settled`);
        if (shardCount === 1) {
            expect(totals.ran).toBeGreaterThan(400);
            // Silence alone must not let a lost inference rule pass unnoticed.
            expect(totals.settled / totals.names).toBeGreaterThan(0.75);
        } else {
            const summary = process.env.RANK_TYPE_AUDIT_SUMMARY;
            if (!summary) throw new Error('Missing type audit summary path');
            fs.writeFileSync(summary, JSON.stringify({ shard, shardCount, ...totals }));
        }
    });
});
