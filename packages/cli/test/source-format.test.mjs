import assert from 'node:assert/strict';
import test from 'node:test';
import { Interpreter, formatValue, standardModules } from '@rank/interpreter';
import { formatSource } from '../out/source-format.js';

const mask = 'Mask = Fibs multiple by 5 or Fibs multiple by 3';
const foldedMask = 'Mask = (\n  Fibs multiple by 5\n  or Fibs multiple by 3\n)';

function evaluate(source) {
    const interpreter = new Interpreter({ modules: standardModules });
    try { return formatValue(interpreter.execute(source)); }
    finally { interpreter.dispose(); }
}

test('folds the Fibonacci mask into logical clauses within 40 columns', () => {
    assert.equal(formatSource(mask), foldedMask);
    const prefix = 'use sequences\nuse numbers\nFibs = fibonacci until 1000\n';
    const suffix = '\nFibs Mask';
    assert.equal(evaluate(prefix + foldedMask + suffix), evaluate(prefix + mask + suffix));
});

test('reuses outer parentheses and repeated formatting is stable', () => {
    assert.equal(formatSource('Mask = (Fibs multiple by 5 or Fibs multiple by 3)'), foldedMask);
    assert.equal(formatSource(foldedMask), foldedMask);
});

test('preserves precedence, unary signs and grouped operands', () => {
    for (const source of [
        'A = 123456 + 234567 * 345678 - 456789 // 3 + -2',
        'A = (123456 + 234567) * 345678 - 456789 // 3',
        'A = 123456 not equal 234567 and 345678 at least 456789',
    ]) {
        const formatted = formatSource(source);
        assert.notEqual(formatted, source);
        assert.ok(formatted.split('\n').every(line => line.length <= 40));
        assert.equal(evaluate(formatted), evaluate(source));
    }
});

test('folds a return expression without changing block indentation or behavior', () => {
    const source = 'fun mask Fibs\n  return Fibs multiple by 5 or Fibs multiple by 3\nend';
    const formatted = formatSource(source);
    assert.equal(formatted, 'fun mask Fibs\n  return (\n    Fibs multiple by 5\n    or Fibs multiple by 3\n  )\nend');
    assert.equal(evaluate('use numbers\n' + formatted + '\n15 mask'), 'true');
});

test('keeps text, multiline text and comments intact', () => {
    for (const source of [
        'S = "a very long string with + and or that must stay intact"',
        'S = "first line\nMask = Fibs multiple by 5 or Fibs multiple by 3\nlast line"',
        'rem Mask = Fibs multiple by 5 or Fibs multiple by 3',
    ]) assert.equal(formatSource(source), source);
    assert.equal(formatSource(mask + ' rem mask'), foldedMask + ' rem mask');
});

test('does not rewrite incomplete input or invent bindings for an unbreakable call', () => {
    for (const source of [
        mask + ' or',
        'Result = VeryLongVariableName another_long_function_name',
    ]) assert.equal(formatSource(source), source);
});
