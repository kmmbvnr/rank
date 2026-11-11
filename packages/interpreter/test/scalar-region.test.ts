import { LocalFrame } from '../src/frame.js';
import { BindingEnvironment } from '../src/binding-environment.js';
import { compileScalarRegion } from '../src/jit/scalar-region.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, parse } from '../src/index.js';
import { withInterrupt, withDemandBudget } from '../src/interrupt.js';

function run(source: string, compilation: boolean, trace = false) {
    const output: string[] = [], diagnostics = new RuntimeDiagnostics(Infinity, trace);
    const runtime = new Interpreter(value => output.push(value), { compilation, sourceId: 'regions.ra' });
    let value: string | undefined, error: string | undefined;
    try {
        diagnostics.run(() => {
            try { const result = runtime.execute(source); if (result !== undefined) value = formatValue(result); }
            catch (cause) { if (!(cause instanceof RankError)) throw cause; error = cause.format(); }
        });
        return { outcome: { value, error, output }, diagnostics };
    } finally { runtime.dispose(); }
}
const updates = (count = 24) => ' N += 1\n'.repeat(count);
function helper(body: string, input = '1') {
    return `use io\nfun N work\n${body} N print\n return N\nend\n${input} work`;
}
function compare(source: string, error = false) {
    const reference = run(source, false), compiled = run(source, true), traced = run(source, true, true);
    expect(compiled.outcome).toEqual(reference.outcome);
    expect(traced.outcome).toEqual(reference.outcome);
    if (!error) expect(compiled.outcome.error).toBeUndefined();
    expect(traced.diagnostics.compiledScalarRegions).toBe(compiled.diagnostics.compiledScalarRegions);
    return compiled;
}

describe('scalar regions in framed bodies', () => {
    it.each(['1', '1.5', '9007199254740993', '9223372036854775808'])('keeps live numeric domains for %s', input => {
        const result = compare(helper(updates(), input));
        expect(result.diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it('compiles short arithmetic runs inside effectful helpers', () => {
        expect(compare(helper(updates(8))).diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it('publishes values before and after output boundaries', () => {
        const result = compare(helper(updates() + ' N print\n' + updates()));
        expect(result.outcome.output).toEqual(['25', '49']);
        expect(result.diagnostics.compiledScalarRegions).toBeGreaterThan(1);
    });
    it('retains multiple local results and dependencies', () => {
        const body = ' Count = N\n Carry = 2\n' + ' Count += Carry\n Carry = Carry * 2\n N = Count + Carry\n'.repeat(8);
        expect(compare(helper(body)).diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it('keeps mixed comparisons exact above the Number integer range', () => {
        const body = ' Flag = N equal 9007199254740992.0\n'.repeat(20) + ' Flag print\n';
        const result = compare(helper(body, '9007199254740993'));
        expect(result.outcome.output[0]).toBe('false');
        expect(result.diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it.each(['//', 'mod', '/'])('publishes the prefix before %s by zero', operator => {
        const body = updates(10) + ` N = N ${operator} 0\n` + updates(14);
        // A surrounding finally observes the live binding after the error.
        const source = `use io\nfun N work\n try\n${body} finally\n N print\n end\n return N\nend\n${operator === '/' ? '1.5' : '1'} work`;
        const result = compare(source, true);
        expect(result.outcome.error).toBeDefined();
        expect(result.outcome.output).toEqual([operator === '/' ? '11.5' : '11']);
        expect(result.diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it('does not replay the completed prefix after a contract rejection', () => {
        const source = helper(updates(10) + ' N = 1.5\n' + updates(14));
        const result = compare(source, true);
        expect(result.outcome.error).toBeDefined();
    });
    it('preserves rejection of statically protected bindings', () => {
        const source = helper(updates(80) + " Saved' = N * 2\n" + updates(80) + ' Saved print\n');
        const result = compare(source, true);
        expect(result.outcome.error).toContain('read-only');
    });
    it('rechecks live protection and publishes the earlier prefix on failure', () => {
        const values = new Map([['N', 1n], ['Other', 2n]]);
        const bindings = new BindingEnvironment(values, new Set(['core']));
        const commands = parse(updates(20) + ' Other += 1\n').statements;
        const region = compileScalarRegion(commands, 0, {
            bindings, writer: name => bindings.compileAssign(name),
            check: statement => bindings.checkMutable((statement as { name: string }).name),
            binary: () => { throw new Error('unexpected operator fallback'); },
            locate: error => error,
        })!;
        expect(region.run()).toBe(3n);
        bindings.protect('Other', 'Saved', '')();
        expect(() => region.run()).toThrow('read-only');
        expect(values.get('N')).toBe(41n);
        expect(values.get('Other')).toBe(3n);
    });
    it('does not force a deferred input while testing region admission', () => {
        const source = `use io\nfun compute\n "forced" print\n return 2\nend\nfun N work\n${updates()} N print\n return N\nend\nValue' = compute\nValue work`;
        const result = compare(source);
        expect(result.outcome.output.filter(line => line === 'forced')).toHaveLength(1);
    });
    it('rechecks scalar and array calls through the same body', () => {
        const source = `use io\nuse sequences\nfun N work\n${updates()} N print\n return N\nend\nFirst = 1 work\nSecond = (array 1 2) work\nThird = 1.5 work\ntuple First Second Third`;
        const result = compare(source);
        expect(result.diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it('keeps signed division and remainder semantics', () => {
        const result = compare(helper(' N = (N - 10) mod -3\n N = (N * 7) // -2\n'.repeat(12)));
        expect(result.diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it.each(Array.from({ length: 12 }, (_, seed) => seed + 1))('matches varied scalar composition for seed %s', seed => {
        let state = seed;
        const next = () => state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const real = seed % 2 === 0;
        const lines = [real ? ' Carry = 2.5' : ' Carry = 2', ' Flag = false'];
        for (let index = 0; index < 64; index++) {
            const constant = next() % 11 + 1;
            const operator = (real ? ['+', '-', '*'] : ['+', '-', '*', '//', 'mod'])[next() % (real ? 3 : 5)];
            const target = next() % 2 ? 'N' : 'Carry';
            const other = target === 'N' ? 'Carry' : 'N';
            lines.push(` ${target} = (${other} + ${constant}) ${operator} ${constant}`);
            if (index % 8 === 0) lines.push(' Flag = N less Carry');
        }
        lines.push(' Carry print', ' Flag print');
        const result = compare(helper(lines.join('\n') + '\n', real ? '1.5' : '9007199254740993'));
        expect(result.diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it('bounds specializations while retaining checked fallback', () => {
        const bindings = new BindingEnvironment(new Map(), new Set(['core']));
        const commands = parse('Total = First + Second\nLeft = Total + Third\nRight = First + Third\nTotal = Left + Right').statements;
        const diagnostics = new RuntimeDiagnostics();
        const region = compileScalarRegion(commands, 0, {
            bindings, writer: name => bindings.compileAssign(name),
            check: statement => bindings.checkMutable((statement as { name: string }).name),
            binary: () => { throw new Error('unexpected operator fallback'); }, locate: error => error,
        })!;
        diagnostics.run(() => {
            for (let mask = 0; mask < 8; mask++) {
                bindings.current = new LocalFrame(undefined);
                ['First', 'Second', 'Third'].forEach((name, bit) => bindings.assign(name, mask & (1 << bit) ? 2.5 : 2n));
                if (mask < 4) expect(region.run()).toBeDefined();
                else expect(region.run()).toBeUndefined();
            }
        });
        expect(diagnostics.compiledScalarRegions).toBe(4);
        expect(diagnostics.fallbacks['scalar-region:specialization-budget:4']).toBe(4);
    });
    it('publishes before suspension and reads live values after resuming', () => {
        const source = `fun values\n N = 1\n${updates()} yield N\n${updates()} yield N\nend\nvalues array`;
        const result = compare(source);
        expect(result.outcome.value).toBe('25 49');
        expect(result.diagnostics.compiledScalarRegions).toBeGreaterThan(0);
    });
    it('disables register publication when a host can observe polling', () => {
        const source = helper(updates(300));
        const result = withInterrupt(new Int32Array(new SharedArrayBuffer(4)), () => compare(source));
        expect(result.diagnostics.compiledScalarRegions).toBe(0);
    });
    it('keeps the ordinary demand-budget path', () => {
        const source = helper(updates(300));
        const result = withDemandBudget(100000, () => compare(source));
        expect(result.diagnostics.compiledScalarRegions).toBe(0);
    });
});
