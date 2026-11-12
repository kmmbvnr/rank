import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

process.env.RANK_DEMO_AUDIT_SCALE = 'small';
const { auditArguments, auditEligible, auditSource } = await import('./demo-audit-inputs.mjs');

const inputs = JSON.parse(readFileSync(new URL('./demo-audit-inputs.json', import.meta.url), 'utf8'));

test('bounded audit inputs name existing arguments and retain executable assertions', () => {
    for (const [file, input] of Object.entries(inputs)) {
        const source = readFileSync(new URL('../demos/' + file, import.meta.url), 'utf8');
        for (const name of Object.keys(input.args ?? {})) {
            assert.match(source, new RegExp(`^arg ${name} `, 'm'), `${file}: ${name}`);
        }
        const tests = [...source.matchAll(/^test "([^"]+)"/gm)].map(match => match[1]);
        for (const name of input.excludeTests ?? []) assert.ok(tests.includes(name), `${file}: ${name}`);
        if (input.excludeTests) assert.ok(tests.some(name => !input.excludeTests.includes(name)), file);
    }
});

test('bounded runs preserve source offsets and reject an empty test selection', () => {
    const source = 'test "default input"\n false\nend\ntest "small"\n true\nend\n';
    const end = source.indexOf('\ntest "small"');
    const program = { statements: [
        { $type: 'TestStatement', description: 'default input', $cstNode: { offset: 0, end } },
        { $type: 'TestStatement', description: 'small', $cstNode: { offset: end + 1, end: source.length - 1 } },
    ] };
    const selected = auditSource('euler/700_eulercoin_test.ra', source, program);
    assert.equal(selected.length, source.length);
    assert.equal(selected.indexOf('test "small"'), source.indexOf('test "small"'));
    assert.ok(!selected.includes('false'));
    assert.throws(() => auditSource('euler/700_eulercoin_test.ra', source, { statements: program.statements.slice(0, 1) }), /No small/);
    assert.deepEqual(auditArguments('euler/700_eulercoin.ra'), ['--aa=3', '--mm=7', '--cut=2']);
    assert.equal(auditEligible('euler/700_eulercoin.ra'), true);
    assert.equal(auditEligible('euler/238_infinitestring.ra'), false);
    assert.equal(auditEligible('euler/350_constraining_default_test.ra'), false);
});

test('full audits retain the original inputs and every embedded assertion', () => {
    const module = new URL('./demo-audit-inputs.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { auditArguments, auditEligible, auditSource } from ${JSON.stringify(module)};
        assert.deepEqual(auditArguments('euler/700_eulercoin.ra'), []);
        assert.equal(auditEligible('euler/238_infinitestring.ra'), true);
        assert.equal(auditEligible('euler/350_constraining_default_test.ra'), true);
        assert.equal(auditSource('euler/700_eulercoin_test.ra', 'original', undefined), 'original');
    `], { env: { ...process.env, RANK_DEMO_AUDIT_SCALE: 'full' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
