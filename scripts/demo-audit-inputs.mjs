import { readFileSync } from 'node:fs';

const inputs = JSON.parse(readFileSync(new URL('./demo-audit-inputs.json', import.meta.url), 'utf8'));
export const auditScale = process.env.RANK_DEMO_AUDIT_SCALE ?? 'small';
if (!['small', 'full'].includes(auditScale)) throw new Error('Invalid demo audit scale');

/** Keep published defaults intact; compare execution modes on bounded inputs. */
export function auditEligible(file) {
    return auditScale === 'full' || (!file.endsWith('_default_test.ra') && !inputs[file]?.fullOnly);
}

export function auditArguments(file) {
    return auditScale === 'full' ? [] : Object.entries(inputs[file]?.args ?? {})
        .map(([name, value]) => `--${name.toLowerCase()}=${value}`);
}

/** Full-size assertions remain available through the explicit full audit. */
export function auditSource(file, source, program) {
    const excluded = auditScale === 'full' ? [] : inputs[file]?.excludeTests ?? [];
    if (!excluded.length) return source;
    const tests = program.statements.filter(statement => statement.$type === 'TestStatement');
    if (excluded.some(name => !tests.some(test => test.description === name))) {
        throw new Error(`Unknown audit test in ${file}`);
    }
    if (tests.every(test => excluded.includes(test.description))) {
        throw new Error(`No small audit tests in ${file}`);
    }
    for (const test of tests.filter(test => excluded.includes(test.description)).reverse()) {
        const { offset, end } = test.$cstNode;
        // Preserve line numbers for diagnostics and source analysis.
        source = source.slice(0, offset) + source.slice(offset, end).replace(/[^\r\n]/g, ' ') + source.slice(end);
    }
    return source;
}
