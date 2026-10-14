import assert from 'node:assert/strict';
import { test } from 'node:test';
import { semanticSource } from './semantic-source.mjs';

test('comments and ordinary strings do not create dependencies or semantic violations', () => {
    assert.deepEqual(semanticSource(`
        // import { X } from '@arrrank/interpreter'; inferRequirements();
        /* function explicitCall(value: Expression) {} */
        const documentation = "from './requirement-solver.js' and .requirements";
    `), { imports: [], recognizer: false, requirements: false });
});

test('distinguishes runtime dependencies from all forms of type-only imports and exports', () => {
    const facts = semanticSource(`
        import './side-effect.js';
        import type { A } from './a.js';
        import { type B } from './b.js';
        import { type C, value } from './c.js';
        import Default, { type D } from './d.js';
        import * as E from './e.js';
        export type { F } from './f.js';
        export { type G } from './g.js';
        export { type H, value } from './h.js';
        export * from './i.js';
        export type * from './j.js';
        type K = import('./k.js').K;
        const load = () => import('./l.js');
        import M = require('./m.js');
    `);
    assert.deepEqual(facts.imports, [
        ['side-effect', true], ['a', false], ['b', false], ['c', true], ['d', true],
        ['e', true], ['f', false], ['g', false], ['h', true], ['i', true],
        ['j', false], ['k', false], ['l', true], ['m', true],
    ].map(([name, value]) => ({ specifier: `./${name}.js`, value })));
});

test('recognizes semantic owner helpers from declarations and typed closures', () => {
    for (const source of [
        'function explicitCall(value: unknown) {}',
        'function callForm(value: Expression) {}',
        'const callForm = (value: readonly (NameExpression | BinaryExpression)[]) => {};',
        'const callForm = function (value: language.Expression) {};',
    ]) assert.equal(semanticSource(source).recognizer, true, source);
    for (const source of ['function format(value: Expression) {}', 'function callForm(value: string) {}']) {
        assert.equal(semanticSource(source).recognizer, false, source);
    }
});

test('retains requirement restrictions for aliases, properties, types, and module paths', () => {
    for (const source of [
        "import { inferRequirements as infer } from '@arrrank/language';",
        'type Facts = RequirementAnalysis;',
        'const value = facts.requirements;',
        'const value = facts["requirements"];',
        "export { solve } from './analysis/requirement-solver.js';",
    ]) assert.equal(semanticSource(source).requirements, true, source);
});
