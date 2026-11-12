import { describe, expect, it } from 'vitest';
import { Interpreter, RankError } from '../src/index.js';

const program = 'use cli\narg Verbose boolean = false\nVerbose';

function run(args: string[], source = program) {
    return new Interpreter(() => undefined, { args }).execute(source);
}

describe('boolean program inputs', () => {
    it.each([
        [[], false],
        [['--verbose'], true],
        [['--verbose', 'true'], true],
        [['--verbose', 'false'], false],
        [['--verbose=false'], false],
    ] as const)('binds %j to %s', (args, expected) => {
        expect(run([...args])).toBe(expected);
    });

    it('rejects a value that is not a boolean', () => {
        expect(() => run(['--verbose', 'maybe'])).toThrow('expected boolean input, got: maybe');
    });

    it('still requires a boolean input without a default', () => {
        expect(() => run([], 'use cli\narg Verbose boolean\nVerbose')).toThrow('missing argument: --verbose');
        expect(run(['--verbose'], 'use cli\narg Verbose boolean\nVerbose')).toBe(true);
    });

    it('no longer accepts the flag keyword and names the replacement', () => {
        let error: unknown;
        try { run([], 'use cli\nflag Verbose\nVerbose'); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(RankError);
        expect((error as RankError).message).toContain('arg Name boolean = false');
    });
});
