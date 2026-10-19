import * as fs from 'node:fs';
import * as path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { AstUtils } from 'langium';
import { afterAll, describe, expect, it } from 'vitest';
import {
    isAssignmentStatement, isForStatement, isFunctionStatement, isNameExpression,
    isUnpackStatement, type Program,
} from '@arrrank/language';
import { Interpreter, isRankArray, parse, typeName } from '@arrrank/interpreter';
import { nameFactsIn } from '../src/name-facts.js';

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
    return files;
}

/** Names bound once and never rebound. Writing into an array cell keeps its type, rank and shape. */
function settledNames(program: Program): Set<string> {
    const writes = new Map<string, number>();
    const spoiled = new Set<string>();
    for (const node of AstUtils.streamAllContents(program)) {
        if (isAssignmentStatement(node)) writes.set(node.name, (writes.get(node.name) ?? 0) + 1);
        else if (isUnpackStatement(node)) node.names.forEach(name => spoiled.add(name));
        else if (isFunctionStatement(node)) node.parameters.forEach(name => spoiled.add(name));
        else if (isForStatement(node) && node.condition) {
            for (const part of AstUtils.streamAllContents(node.condition)) if (isNameExpression(part)) spoiled.add(part.name);
        }
    }
    return new Set([...writes].filter(([name, count]) => count === 1 && !spoiled.has(name)).map(([name]) => name));
}

/**
 * The rule that makes the footer worth reading: the analyzer may say `unknown`, but it may
 * never say something false. Every demo that runs without a host — no standard input, no
 * files, no database — is asked about each settled name, where it is written and where it is
 * read, and the answer is checked against the value the run produced.
 */
describe('facts at a name against the values a run produced', () => {
    const files = programs();
    let ran = 0;
    let asked = 0;
    let known = 0;
    let finished = 0;

    for (const file of files) {
        it(path.relative(demos, file), async context => {
            const contradictions: string[] = [];
            await setImmediate();
            finished += 1;
            const source = fs.readFileSync(file, 'utf8');
            let program: Program;
            try { program = parse(source, file); } catch { return context.skip(); }
            const interpreter = new Interpreter(() => undefined, { sourceId: file, testing: true });
            try { interpreter.execute(source); } catch { return context.skip(); } finally { interpreter.dispose(); }
            ran += 1;

            const lookup = nameFactsIn(source);
            const label = path.relative(demos, file);
            if (!lookup) { contradictions.push(`${label}: no analysis for a program that parses`); expect(contradictions).toEqual([]); return; }
            const settled = settledNames(program);
            for (const node of AstUtils.streamAllContents(program)) {
                const name = isAssignmentStatement(node) ? node.name : isNameExpression(node) ? node.name : undefined;
                if (name === undefined || !settled.has(name) || AstUtils.getContainerOfType(node, isFunctionStatement)) continue;
                const value = interpreter.variables.get(name);
                const offset = node.$cstNode?.offset;
                if (value === undefined || offset === undefined) continue;
                const found = lookup(offset);
                asked += 1;
                if (!found) { contradictions.push(`${label} ${name}@${offset}: no name found at its own offset`); continue; }
                const { facts } = found;
                if (!facts.types.length) continue;
                known += 1;
                if (!facts.types.includes(typeName(value))) {
                    contradictions.push(`${label} ${name}: facts say ${facts.types.join(' or ')}, ran as ${typeName(value)}`);
                }
                if (isRankArray(value)) {
                    if (facts.rank !== undefined && facts.rank !== value.shape.length) {
                        contradictions.push(`${label} ${name}: facts say rank ${facts.rank}, ran as ${value.shape.length}`);
                    }
                    if (facts.shape?.some((size, axis) => size !== null && size !== value.shape[axis])) {
                        contradictions.push(`${label} ${name}: facts say shape ${facts.shape}, ran as ${value.shape}`);
                    }
                }
            }
            expect(contradictions).toEqual([]);
        // Bound each program, rather than giving the growing corpus one deadline.
        }, 300_000);
    }

    afterAll(() => {
        // A name-filtered run checks its selected programs; only a full run owns the coverage gate.
        if (finished !== files.length) return;
        console.log(`name facts: ${ran} demos run, ${asked} names asked, ${known} known`);
        // A vacuous pass proves nothing: the corpus must be run and the analyzer must answer for some of it.
        expect(ran).toBeGreaterThan(100);
        expect(known).toBeGreaterThan(50);
    });
});
