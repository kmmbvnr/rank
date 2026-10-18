import { describe, expect, it } from 'vitest';
import { EnvironmentOverlay, Interpreter, MISSING, isRankSequence } from '../src/index.js';

describe('environment reads and overlays', () => {
    it('writes literal and dynamic addresses, deletes inherited values, and preserves aliases', () => {
        const environment = EnvironmentOverlay.from([['HOST', 'inherited']]);
        const runtime = new Interpreter(undefined, { environment });
        expect(runtime.execute('use cli\nenv "HOST" = "first"\n"HOST" env')).toBe('first');
        expect(runtime.execute('Name = "HOST"\nenv Name = "second"\nName env')).toBe('second');
        expect(runtime.execute('e = env\ne Name = "third"\nName e')).toBe('third');
        expect(runtime.execute('env Name = .NA\nName env')).toBe(MISSING);
        expect(runtime.execute('env Name = ""\nName env default "fallback"')).toBe('');
    });
    it('keeps unopened env names available for ordinary function bindings', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('fun Name env = Name + 1\n3 env')).toBe(4n);
    });
    it('isolates preview writes through imported functions and nested calls', () => {
        const environment = EnvironmentOverlay.from([['HOST', 'original']]);
        const source = 'use cli\nfun Value change\n  env "HOST" = Value\n  return "HOST" env\nend\n'
            + 'fun Value nested\n  fun Value changeit\n    env "HOST" = Value\n    return "HOST" env\n  end\n  return Value changeit\nend';
        const runtime = new Interpreter(undefined, { environment, loadModule: () => ({ id: 'module.ra', source }) });
        runtime.execute('use cli\nuse "module" as lib');
        const preview = runtime.forkForPreview();
        expect(preview.execute('"preview" lib.change')).toBe('preview');
        expect(preview.execute('"HOST" env')).toBe('preview');
        expect(preview.execute('"nested" lib.nested')).toBe('nested');
        expect(preview.execute('"HOST" env')).toBe('nested');
        const escaped = preview.execute('lib.nested')!;
        expect(typeof escaped === 'object' && 'call' in escaped && escaped.call(['outside'])).toBe('outside');
        expect(runtime.execute('"HOST" env')).toBe('original');
        preview.dispose();
        expect(runtime.execute('"normal" lib.nested')).toBe('normal');
    });
    it('rejects environment dependencies in memo while ordinary functions observe changes', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use cli\nenv "HOST" = "first"\nfun Ignored read = "HOST" env');
            expect(runtime.execute('0 read')).toBe('first');
            expect(() => runtime.execute('memo Ignored cached = "HOST" env')).toThrow('external effects');
            runtime.execute('env "HOST" = "second"');
            expect(runtime.execute('0 read')).toBe('second');
        } finally { runtime.dispose(); }
    });
    it.each([true, false])('observes writes inside repeated calls with compilation %s', compiled => {
        const runtime = new Interpreter(undefined, {
            integerLoopCompilation: compiled, blockCompilation: compiled,
            scalarCompilation: compiled, scalarFunctionCompilation: compiled,
            functionBodyCompilation: compiled,
        });
        const result = runtime.execute('use cli\nenv "COUNT" = "0"\nfun bump\n  N = "COUNT" env integer\n  env "COUNT" = (N + 1) text\n  return "COUNT" env integer\nend\nTotal = 0\nfor I in 1 to 4\n  Total += bump\nend\nTotal');
        expect(result).toBe(10n);
        expect(runtime.execute('"COUNT" env')).toBe('4');
    });
    it('keeps delayed generator effects inside the environment where the call was made', () => {
        const environment = EnvironmentOverlay.from([['HOST', 'original']]);
        const runtime = new Interpreter(undefined, { environment, loadModule: () => ({ id: 'module.ra', source:
            'use cli\nfun Value changes\n  env "HOST" = Value\n  yield "HOST" env\nend' }) });
        runtime.execute('use cli\nuse "module" as lib');
        const preview = runtime.forkForPreview();
        try {
            const result = preview.execute('"delayed" lib.changes');
            expect(result && isRankSequence(result)).toBe(true);
            if (!result || !isRankSequence(result)) throw new Error('expected a generator');
            expect([...result.plan.iterate()]).toEqual(['delayed']);
            expect(preview.execute('"HOST" env')).toBe('delayed');
            expect(runtime.execute('"HOST" env')).toBe('original');
        } finally { preview.dispose(); }
    });
    it('isolates each test from the parent and other tests, including module calls', () => {
        const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'module.ra', source:
            'use cli\nfun Value change\n  env "HOST" = Value\n  return "HOST" env\nend' }) });
        runtime.execute('use cli\nuse testing\nenv "HOST" = "parent"\n'
            + 'test "first"\n  use cli\n  use "module" as lib\n  "child" lib.change\n  "HOST" env equal "child"\nend\n'
            + 'test "second"\n  use cli\n  "HOST" env equal "parent"\nend');
        expect(runtime.testResults.map(result => result.passed)).toEqual([true, true]);
        expect(runtime.execute('"HOST" env')).toBe('parent');
    });
    it('rejects compound writes and validates addresses before evaluating the RHS', () => {
        const runtime = new Interpreter();
        runtime.execute('use cli\nenv "HOST" = "old"');
        expect(() => runtime.execute('env "HOST" += "new"')).toThrow(/compound/);
        expect(() => runtime.execute('env "" = (1 / 0)')).toThrow(/nonempty/);
        expect(() => runtime.execute('env "HOST" = (1 / 0)')).toThrow();
        expect(runtime.execute('"HOST" env')).toBe('old');
        expect(() => runtime.execute('env "HOST" = 1')).toThrow(/text or missing/);
    });
    it('evaluates address and RHS effects once and in order, and reports host write failures', () => {
        const printed: string[] = [];
        const runtime = new Interpreter(line => printed.push(line));
        runtime.execute('use cli\nuse io\nenv ("HOST" print) = ("value" print)');
        expect(printed).toEqual(['HOST', 'value']);
        expect(runtime.execute('"HOST" env')).toBe('value');
        printed.length = 0;
        expect(() => runtime.execute('env ("" print) = ("not evaluated" print)')).toThrow();
        expect(printed).toEqual(['']);
        const failing = new Interpreter(undefined, { environment: {
            get() { return undefined; }, set() { throw new Error('write denied'); },
        } });
        expect(() => failing.execute('use cli\nenv "HOST" = "value"')).toThrow(/write denied/);
        runtime.variables.set('Bad', 'a\0b');
        expect(() => runtime.execute('env "HOST" = Bad')).toThrow(/NUL/);
        expect(() => runtime.execute('env Bad = "value"')).toThrow(/NUL/);
    });
    it('distinguishes absent and empty values and uses lazy defaults', () => {
        const environment = EnvironmentOverlay.from([['EMPTY', ''], ['PORT', '8080']]);
        const runtime = new Interpreter(undefined, { environment });
        expect(runtime.execute('use cli\n"EMPTY" env')).toBe('');
        expect(runtime.execute('"ABSENT" env')).toBe(MISSING);
        expect(runtime.execute('"EMPTY" env default (1 / 0)')).toBe('');
        expect(runtime.execute('("PORT" env default "1") integer')).toBe(8080n);
        environment.set('PORT', 'bad');
        expect(() => runtime.execute('("PORT" env default "1") integer')).toThrow();
    });
    it('keeps inherited deletions and prototype-like names local to an overlay', () => {
        const parent = EnvironmentOverlay.from([['HOST', 'original']]);
        const child = new EnvironmentOverlay(parent);
        child.set('HOST', undefined);
        child.set('__proto__', 'plain value');
        expect(child.get('HOST')).toBeUndefined();
        expect(parent.get('HOST')).toBe('original');
        expect(child.get('__proto__')).toBe('plain value');
        child.set('HOST', 'new');
        expect(child.get('HOST')).toBe('new');
    });
    it('preserves host case policy through overlays', () => {
        const parent = EnvironmentOverlay.from([['Host', 'original']], true);
        const child = new EnvironmentOverlay(parent);
        expect(child.get('hOsT')).toBe('original');
        child.set('HOST', undefined);
        expect(child.get('host')).toBeUndefined();
    });
    it('requires the cli import and validates names and host failures', () => {
        expect(() => new Interpreter().execute('"HOST" env')).toThrow(/cli/);
        const runtime = new Interpreter();
        for (const name of ['', 'A=B']) expect(() => runtime.execute(`use cli\n"${name}" env`)).toThrow(/nonempty/);
        const failing = new Interpreter(undefined, { environment: {
            get() { throw new Error('host failure'); }, set() {},
        } });
        expect(() => failing.execute('use cli\n"HOST" env')).toThrow(/host failure/);
    });
});
