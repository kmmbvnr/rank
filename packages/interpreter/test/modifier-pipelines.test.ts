import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('modifier pipelines', () => {
    it('continues after scalar rank application', () => {
        expect(run('use text\nuse numbers\n"1203" integer rank 0 sum')).toBe('6');
    });

    it('continues after scan and reduce', () => {
        expect(run('use numbers\n(array 1 2 3) + scan sum')).toBe('10');
        expect(run('use numbers\n(array 2 3 4) * reduce abs')).toBe('24');
    });

    it('composes multiple modifiers', () => {
        expect(run('use text\nuse numbers\n"1203" integer rank 0 + scan sum')).toBe('13');
        expect(run('use numbers\n(array 1 2) (array 3 4) * outer sum rank 1 sum')).toBe('21');
    });

    it('continues after axis and combined axis/rank selection', () => {
        const matrix = 'M = array shape 2 2\n  1 2\n  3 4\nend\n';
        expect(run('use numbers\n' + matrix + 'M sum axis 0 sum')).toBe('10');
        expect(run('use numbers\n' + matrix + 'M sum axis 0 rank 1 sum')).toBe('10');
        expect(run('use numbers\n' + matrix + 'M + reduce rank 1 sum')).toBe('10');
    });

    it('keeps modifier argument diagnostics in a pipeline', () => {
        expect(() => run('use text\n"12" integer rank "bad" print'))
            .toThrowError('rank expects a nonnegative integer');
    });

    it('prints the completed result and evaluates the source once', () => {
        const output: string[] = [];
        new Interpreter(line => output.push(line)).execute([
            'use io', 'use text', 'use numbers',
            'fun source N', '  N print', '  return "1203"', 'end',
            '7 source integer rank 0 sum print',
        ].join('\n'));
        expect(output).toEqual(['7', '6']);
    });
});
