import { describe, expect, it } from 'vitest';
import { compiledOperators, isFunctionStatement } from '@arrrank/language';
import { parse } from '../src/index.js';
import { scalarFunctionResult } from '../src/scalar-function-proof.js';
import { compileScalarFunction } from '../src/scalar-function-kernel.js';

function statement(body: string) {
    const result = parse(`fun helper X Y\n${body}\nend`).statements[0];
    if (!isFunctionStatement(result)) throw new Error('expected function');
    return result;
}

// Pin the pre-migration compiler boundary independently of the catalogue.
const cases = [
    ['+X', 'integer', 7n], ['-X', 'integer', -7n],
    ['X + Y', 'integer', 10n], ['X - Y', 'integer', 4n],
    ['X * Y', 'integer', 21n], ['X // Y', 'integer', 2n], ['X % Y', 'integer', 1n],
    ['X less Y', 'boolean', false], ['X greater Y', 'boolean', true],
    ['X at most Y', 'boolean', false], ['X at least Y', 'boolean', true],
    ['X equal Y', 'boolean', false], ['X not equal Y', 'boolean', true],
    ['true equal false', 'boolean', false], ['true not equal false', 'boolean', true],
    ['true and false', 'boolean', false], ['true or false', 'boolean', true],
    ['true xor false', 'boolean', true], ['not true', 'boolean', false],
] as const;

describe('scalar function operator eligibility', () => {
    it.each(cases)('proves and executes %s', (expression, type, value) => {
        const fn = statement(`return ${expression}`);
        expect(scalarFunctionResult(fn)).toEqual({ type, locals: [] });
        const kernel = compileScalarFunction(fn);
        expect(kernel).toBeDefined();
        expect(kernel!.run([7n, 3n], error => error)).toBe(value);
    });

    it('has executable coverage for every catalogue overload', () => {
        for (const operation of compiledOperators) {
            for (const signature of operation.scalarFunction) {
                const inputs = signature.inputs.map(type => type === 'integer' ? '3' : 'true');
                const name = ({ atmost: 'at most', atleast: 'at least', notequal: 'not equal' } as Record<string, string>)[operation.name] ?? operation.name;
                const expression = inputs.length === 1 ? `${name} ${inputs[0]}`
                    : `${inputs[0]} ${name} ${inputs[1]}`;
                const fn = statement(`return ${expression}`);
                expect(scalarFunctionResult(fn)?.type, expression).toBe(signature.result);
                expect(compileScalarFunction(fn), expression).toBeDefined();
            }
        }
    });

    it.each([
        'X / Y', 'X ** Y', 'X to Y', 'X to Y step 2',
        'X and Y', 'not X', '-true', '+true', 'true + false',
        'true less false', 'X equal true', 'true not equal X',
        'X + 0.5', '"a" equal "b"', 'X abs', 'Missing',
    ])('keeps %s outside the compiler subset', expression => {
        const fn = statement(`return ${expression}`);
        expect(scalarFunctionResult(fn)).toBeUndefined();
        expect(compileScalarFunction(fn)).toBeUndefined();
    });

    it.each([
        ['X += Y', 10n], ['X -= Y', 4n], ['X *= Y', 21n],
        ['X //= Y', 2n], ['X %= Y', 1n],
        ['Good = true\nGood and= false', false],
        ['Good = false\nGood or= true', true],
        ['Good = true\nGood xor= true', false],
    ])('preserves compound assignment %s', (body, value) => {
        const fn = statement(`${body}\nreturn ${body.startsWith('Good') ? 'Good' : 'X'}`);
        expect(scalarFunctionResult(fn)).toBeUndefined();
        expect(scalarFunctionResult(fn, true)).toBeDefined();
        expect(compileScalarFunction(fn)!.run([7n, 3n], error => error)).toBe(value);
    });

    it.each([
        'X /= Y\nreturn X', 'X **= Y\nreturn X',
        'X and= Y\nreturn X', 'Good = true\nGood += false\nreturn Good',
        'Local += X\nreturn Local', 'X = true\nreturn X',
        'if X greater Y\nreturn X\nelse\nreturn true\nend',
        'return X\nfun nested Z\nreturn Z\nend',
    ])('retains block rejection for %s', body => {
        expect(scalarFunctionResult(statement(body), true)).toBeUndefined();
    });
});
