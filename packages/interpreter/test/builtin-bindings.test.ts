import { expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { run } from './support.js';

it('rejects core names, parameters and nested declarations', () => {
    for (const source of ['fun sum X\n return X\nend',
        'fun f sum\n return sum\nend',
        'fun f X\n fun sum Y\n return Y\n end\n return X\nend']) {
        expect(() => run(source)).toThrow('cannot redefine available builtin: sum');
    }
});

it('rejects module conflicts in either declaration order', () => {
    const declaration = 'fun solve X\n return X\nend';
    for (const source of [`use linalg\n${declaration}`, `${declaration}\nuse linalg`]) {
        expect(() => run(source)).toThrow('cannot redefine available builtin: solve');
    }
    expect(run(`${declaration}\n7 solve`)).toBe('7');
});

it('checks module activation across separate executions without corrupting the session', () => {
    const runtime = new Interpreter();
    runtime.execute('fun solve X\n return X\nend');
    expect(() => runtime.execute('use linalg')).toThrow('cannot redefine available builtin: solve');
    expect(runtime.modules.has('linalg')).toBe(false);
    expect(formatValue(runtime.execute('7 solve')!)).toBe('7');
});

it('retains builtin aliases and receiver methods', () => {
    expect(run('op = sum\n(array 1 2 3) op')).toBe('6');
    expect(run('use graph\nfun find A B\n return 99\nend\nD = new dsu (array 1 2)\nD findroot 1')).toBe('1');
});

it('checks retained function parameters and nested declarations before opening a module', () => {
    for (const source of ['fun f mean\n return mean\nend',
        'fun f X\n fun mean Y\n return Y\n end\n return X\nend',
        'memo f mean\n return mean\nend']) {
        const runtime = new Interpreter();
        runtime.execute(source);
        expect(() => runtime.execute('use stats')).toThrow('cannot redefine available builtin: mean');
        expect(runtime.modules.has('stats')).toBe(false);
        runtime.forgetBindings(['f']);
        expect(() => runtime.execute('use stats')).not.toThrow();
    }
});

it('does not apply caller modules to the private scope of an imported function', () => {
    const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'worker',
        source: 'fun f mean\n return mean\nend' }) });
    runtime.execute('use "worker"\nuse stats');
    expect(runtime.execute('7 f')).toBe(7n);
});

it('retains declaration checks in previews and through function aliases', () => {
    const runtime = new Interpreter();
    runtime.execute('memo f mean\n return mean\nend\nalias_fn = f');
    runtime.forgetBindings(['f']);
    for (const session of [runtime, runtime.forkForPreview()]) {
        expect(() => session.execute('use stats')).toThrow('cannot redefine available builtin: mean');
        expect(session.modules.has('stats')).toBe(false);
    }
});

it('does not partially import functions when a later export conflicts', () => {
    const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'worker',
        source: 'fun firstcustom X\n return X\nend\nfun solve X\n return X\nend' }) });
    runtime.execute('use linalg');
    expect(() => runtime.execute('use "worker"')).toThrow('cannot redefine available builtin: solve');
    expect(runtime.variables.has('firstcustom')).toBe(false);
});

it.each(['sum', 'min', 'max', 'len', 'integer', 'real', 'text', 'type', 'raise'])(
    'rejects core %s before optimized execution', name => {
        for (const compiled of [true, false]) {
            const runtime = new Interpreter(undefined, { scalarCompilation: compiled,
                scalarFunctionCompilation: compiled, integerLoopCompilation: compiled, tensorFusion: compiled });
            expect(() => runtime.execute(`fun ${name} X\n return X\nend`))
                .toThrow(`cannot redefine available builtin: ${name}`);
        }
    });

it('checks imported user functions and allows qualified imports', () => {
    const source = 'fun solve X\n return X\nend';
    const create = () => new Interpreter(undefined, { loadModule: () => ({ id: 'worker', source }) });
    expect(() => create().execute('use linalg\nuse "worker"'))
        .toThrow('cannot redefine available builtin: solve');
    expect(() => create().execute('use "worker"\nuse linalg'))
        .toThrow('cannot redefine available builtin: solve');
    expect(create().execute('use linalg\nuse "worker" as W\n7 W.solve')).toBe(7n);
});

it('checks loop bindings and parameters after a module is already loaded', () => {
    expect(() => run('for sum in 1 to 3\n sum\nend')).toThrow('cannot redefine available builtin: sum');
    const runtime = new Interpreter();
    runtime.execute('use stats');
    expect(() => runtime.execute('fun f mean\n return mean\nend'))
        .toThrow('cannot redefine available builtin: mean');
});

it('keeps DSU findroot and collection find distinct when both modules are open', () => {
    expect(run('use graph\nuse sequences\nuse text\nD = new dsu (array "a" "b")\nRoot = D findroot "a"\nRoot lower + "!"')).toBe('a!');
    expect(run('use graph\nuse sequences\n(array "a" "b") "b" find')).toBe('1');
    expect(run('use graph\nop = findroot\nD = new dsu (array "a" "b")\nD "a" op')).toBe('a');
    expect(() => run('use graph\nD = new dsu (array "a")\nD "a" find')).toThrow('DSU find is now findroot');
});

it('explains the removed DSU find spelling before suggesting another module', () => {
    for (const modules of ['use graph', 'use graph\nuse sequences']) {
        for (const call of ['D find "a"', 'D "a" find', '(new dsu (array "a")) "a" find']) {
            for (const compiled of [true, false]) {
                const runtime = new Interpreter(undefined, { scalarCompilation: compiled,
                    scalarFunctionCompilation: compiled, integerLoopCompilation: compiled, tensorFusion: compiled });
                expect(() => runtime.execute(`${modules}\nD = new dsu (array "a")\n${call}`))
                    .toThrow('DSU find is now findroot');
            }
        }
    }
});

it('does not treat a user function named find as a removed builtin', () => {
    expect(run('use graph\nfun find D X\n return 99\nend\nD = new dsu (array "a")\nD "a" find')).toBe('99');
});
