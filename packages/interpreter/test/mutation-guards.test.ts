import { expect, it } from 'vitest';
import { isForStatement, isFunctionStatement } from '@arrrank/language';
import { parse } from '../src/index.js';
import { completed } from '../src/execution.js';
import { MutationGuards } from '../src/mutation-guards.js';
import type { ExecutionContext, PreparedStatement } from '../src/statement-control.js';

const context: ExecutionContext = {
    assertBooleanExpressions: false, insideLoop: false, insideFinally: false, insideGenerator: false,
};

it.each(['run', 'stream'] as const)('rechecks live protection before a prepared %s executes', kind => {
    const statement = parse('A = 0\nA += 1').statements[1];
    let protected_ = false, effects = 0;
    const failure = Error('protected now');
    const guards = new MutationGuards(() => { if (protected_) throw failure; }, error => error);
    const prepared: PreparedStatement = kind === 'run'
        ? { run: () => { effects++; return 1n; } }
        : { stream: () => { effects++; return completed(1n); } };
    const wrapped = guards.wrap(statement, prepared);
    const execute = () => 'run' in wrapped ? wrapped.run(context) : wrapped.stream(context);
    execute();
    protected_ = true;
    expect(execute).toThrow(failure);
    expect(effects).toBe(1);
    protected_ = false;
    execute();
    expect(effects).toBe(2);
});

it('preserves local binding checks and the original mutation error location', () => {
    const fn = parse('fun X change\n X += 1\n return X\nend').statements[0];
    if (!isFunctionStatement(fn)) throw Error('expected function');
    const statement = fn.statements[0];
    const checked: [string, boolean][] = [];
    const failure = Error('protected local'), located = Error('located');
    const guards = new MutationGuards((name, local) => { checked.push([name, local]); throw failure; },
        (error, node) => { expect(error).toBe(failure); expect(node).toBe(statement); return located; });
    const wrapped = guards.wrap(statement, { run: () => { throw Error('must not execute'); } });
    expect(() => { if ('run' in wrapped) wrapped.run(context); }).toThrow(located);
    expect(checked).toEqual([['X', true]]);
});

it('rechecks aggregated loop writes at every compiled entry', () => {
    const program = parse('A = 0\nfor I in 1 to 2\n A += I\nend');
    const loop = program.statements[1];
    if (!isForStatement(loop)) throw Error('expected loop');
    const checked: string[] = [];
    let protected_ = false;
    const guards = new MutationGuards(name => {
        checked.push(name);
        if (name === 'A' && protected_) throw Error('protected accumulator');
    }, error => error);
    guards.statement(loop);
    expect(checked).toContain('A');
    protected_ = true;
    expect(() => guards.statement(loop)).toThrow('protected accumulator');
});
