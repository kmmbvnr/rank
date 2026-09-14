import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeBindings } from '@arrrank/language';
import { Interpreter, parse, typeName } from '../src/index.js';

const demos = fileURLToPath(new URL('../../../demos', import.meta.url));

function programs(): string[] {
    const files: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.ra')) files.push(full);
        }
    };
    walk(demos);
    return files;
}

/**
 * The rule that makes static types worth showing: the analyzer may say nothing,
 * but it may never say something false. Every demo that runs without a host —
 * no standard input, no files, no database — is checked name by name against
 * the values its run actually produced.
 */
describe('inferred types against the values a run produced', () => {
    it('never contradicts the runtime, and settles most program names', () => {
        const contradictions: string[] = [];
        let ran = 0;
        let names = 0;
        let settled = 0;

        for (const file of programs()) {
            const source = fs.readFileSync(file, 'utf8');
            let facts;
            try {
                facts = analyzeBindings(parse(source, file));
            } catch {
                continue; // `rank check` owns parse failures.
            }
            const interpreter = new Interpreter(() => undefined, {
                sourceId: file, testing: true,
            });
            try {
                interpreter.execute(source);
            } catch {
                continue; // A program that needs a host cannot be observed here.
            } finally {
                interpreter.dispose();
            }
            ran += 1;

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
        }

        expect(contradictions).toEqual([]);
        expect(ran).toBeGreaterThan(400);
        // Coverage is a property worth holding on to: a rule that stops firing
        // would otherwise pass unnoticed, since silence is always allowed.
        expect(settled / names).toBeGreaterThan(0.75);
    // Running four hundred programs is the cost of the guarantee; the brute
    // force Euler demos account for most of it.
    }, 120_000);
});
