import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interpreter, RankError, summarizeValue, type RankValue } from '../src/index.js';

function failure(source: string, interpreter = new Interpreter(() => {}, { sourceId: 'contest.ra' })): RankError {
    try { interpreter.execute(source); }
    catch (error) {
        expect(error).toBeInstanceOf(RankError);
        return error as RankError;
    }
    throw new Error('expected a Rank error');
}

describe('runtime diagnostics', () => {
    it('reports the source statement without changing the error message', () => {
        const error = failure('X = 1\n  X / 0');
        expect(error.message).toBe('division by zero');
        expect(error.location).toEqual({ sourceId: 'contest.ra', line: 2, column: 3, sourceLine: '  X / 0' });
        expect(error.format()).toBe('RankError [Runtime]: division by zero\n  at contest.ra:2:3\n2 |   X / 0\n      ^');
        expect(error.toValue().trace).toBe(error.format());
    });

    it.each([
        'fun bad N\n  return N / 0\nend\n1 bad',
        'fun bad N\n  X = N\n  return X / 0\nend\n1 bad',
        'fun bad N\n  yield N\n  yield N / 0\nend\n(1 bad) array',
    ])('keeps the origin inside direct, ordinary and generator functions: %s', source => {
        const error = failure(source);
        expect(error.location?.sourceLine).toContain('/ 0');
        expect(error.location?.column).toBe(3);
        expect(error.formatCalls()).toContain('bad\n  N = 1');
    });

    it('shows the actual cell passed to a ranked function', () => {
        const error = failure(`use sequences
use text
Ranks = "23456789TJQKA"
fun card_value Card
  Rank = Card 0
  return Ranks Rank find
end
Values = ("5H 5C" "" split) card_value rank 0
Values 1`);
        expect(error.rankKind).toBe('Missing');
        expect(error.formatCalls()).toContain('card_value\n  Card = "H"');
        expect(error.message).toBe('find found no matching value');
    });

    it('keeps arguments for nested and memoized calls', () => {
        const error = failure(`memo bad N
  return N / 0
end
fun outer X
  Value = X bad
  return Value
end
7 outer`);
        expect(error.formatCalls()).toBe('bad\n  N = 7\nouter\n  X = 7');
    });

    it('reports the current tail-call arguments', () => {
        const error = failure('fun down N\n  if N equal 0\n    return 1 / 0\n  end\n  return (N - 1) down\nend\n10000 down');
        expect(error.formatCalls()).toBe('down\n  N = 0');
    });

    it('bounds summaries without reading lazy array items or consuming sequences', () => {
        const lazy = { kind: 'array', shape: [1000], itemAt: () => { throw new Error('evaluated'); },
            get items(): RankValue[] { throw new Error('materialized'); } } as RankValue;
        expect(summarizeValue(lazy)).toBe('array[1000]');
        expect(summarizeValue({ kind: 'sequence' } as RankValue)).toBe('<sequence>');
        expect(summarizeValue('a'.repeat(1000)).length).toBeLessThan(100);
        expect(summarizeValue({ kind: 'array', shape: [3], items: ['H', ' ', '5H'] }))
            .toBe('array[3]: "H" " " "5H"');
    });

    it('keeps the original trace when an error is caught and raised again', () => {
        const error = failure('try\n  1 / 0\ncatch Error\n  Error raise\nend');
        expect(error.location?.line).toBe(2);
    });

    it('uses the loaded file name for imported functions and run', () => {
        for (const source of ['use "helper"\n1 bad', 'run "helper"']) {
            const interpreter = new Interpreter(() => {}, {
                sourceId: 'contest.ra',
                loadModule: () => ({ id: 'helper.ra', source: 'fun bad N\n  return N / 0\nend\n1 bad' }),
            });
            expect(failure(source, interpreter).location).toMatchObject({ sourceId: 'helper.ra', line: 2 });
        }
    });

    it('retains old source text across REPL executions', () => {
        const interpreter = new Interpreter();
        interpreter.execute('fun bad N\n  return N / 0\nend');
        expect(failure('1 bad', interpreter).location?.sourceLine).toBe('  return N / 0');
    });

    it('preserves the failing statement after tail-call replacement', () => {
        const error = failure('fun down N\n  if N equal 0\n    return 1 / 0\n  end\n  return (N - 1) down\nend\n10000 down');
        expect(error.location).toMatchObject({ line: 3, column: 5 });
    });

    it('includes missing-value errors and invalid argument types', () => {
        expect(failure('A = array 1\nA 5').location?.line).toBe(2);
        expect(failure('use numbers\n.Bad sqrt').location?.line).toBe(2);
        expect(failure('use numbers\nValues = "text" sqrt\nValues array').location?.line).toBe(3);
    });

    it('does not attach an import hint to a missing qualified member', () => {
        const interpreter = new Interpreter(() => {}, {
            loadModule: () => ({ id: 'helper.ra', source: 'fun identity N\n  return N\nend' }),
        });
        expect(failure('use "helper" as Helper\n1 Helper.abs', interpreter).message).toBe('unknown variable: abs');
    });

    it.each([['abs', 'numbers'], ['shape', 'sequences'], ['print', 'io']])('suggests the library exporting %s', (name, module) => {
        expect(failure(`1 ${name}`).message).toContain(`did you forget \`use ${module}\`?`);
    });

    it('does not invent imports for unknown names or override local functions', () => {
        expect(failure('unknown_thing').message).toBe('unknown name: unknown_thing');
        expect(new Interpreter().execute('fun abs N\n  return N\nend\n1 abs')).toBe(1n);
        expect(new Interpreter().execute('use numbers\n-1 abs')).toBe(1n);
    });

    it('formats parser errors with source context too', () => {
        const error = failure('X =');
        expect(error.rankKind).toBe('Syntax');
        expect(error.format()).toContain('contest.ra:1:');
        expect(error.format()).toContain('1 | X =');
    });

    it('prints CLI diagnostics without a Node stack and exits unsuccessfully', ({ onTestFinished }) => {
        const directory = mkdtempSync(join(tmpdir(), 'rank-diagnostics-'));
        onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
        const file = join(directory, 'error.ra');
        writeFileSync(file, '1 / 0\n');
        const cli = new URL('../../cli/bin/cli.js', import.meta.url);
        const result = spawnSync(process.execPath, [fileURLToPath(cli), file], {
            encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`at ${file}:1:1`);
        expect(result.stderr).toContain('1 | 1 / 0');
        expect(result.stderr).not.toContain('interpreter.js');
        expect(result.stderr).not.toContain('Node.js');
    });
});
