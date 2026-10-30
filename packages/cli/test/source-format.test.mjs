import assert from 'node:assert/strict';
import test from 'node:test';
import { Interpreter, formatValue, standardModules } from '@arrrank/interpreter';
import { formatSource } from '../out/source-format.js';

const mask = 'Mask = Fibs mod 5 equal 0 or Fibs mod 3 equal 0';
const foldedMask = 'Mask = (\n  Fibs mod 5 equal 0\n  or Fibs mod 3 equal 0\n)';

function evaluate(source) {
    const interpreter = new Interpreter({ modules: standardModules });
    try { return formatValue(interpreter.execute(source)); }
    finally { interpreter.dispose(); }
}

test('folds the Fibonacci mask into logical clauses within 40 columns', () => {
    assert.equal(formatSource(mask), foldedMask);
    const prefix = 'use sequences\nuse numbers\nFibs = fibonacci till 1000\n';
    const suffix = '\nFibs Mask';
    assert.equal(evaluate(prefix + foldedMask + suffix), evaluate(prefix + mask + suffix));
});

test('reuses outer parentheses and repeated formatting is stable', () => {
    assert.equal(formatSource('Mask = (Fibs mod 5 equal 0 or Fibs mod 3 equal 0)'), foldedMask);
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
    const source = 'fun Fibs mask\n  return Fibs mod 5 equal 0 or Fibs mod 3 equal 0\nend';
    const formatted = formatSource(source);
    assert.equal(formatted, 'fun Fibs mask\n  return (\n    Fibs mod 5 equal 0\n    or Fibs mod 3 equal 0\n  )\nend');
    assert.equal(evaluate('use numbers\n' + formatted + '\n15 mask'), 'true');
});

test('keeps text, multiline text and comments intact', () => {
    for (const source of [
        'S = "a very long string with + and or that must stay intact"',
        'S = "first line\nMask = Fibs mod 5 equal 0 or Fibs mod 3 equal 0\nlast line"',
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

test('preserves loop binding semantics and execution result on long for headers (#473)', () => {
    const source = `StartPosition = 1
ContextLimit = 3
Total = 0
for Position in StartPosition till ContextLimit
  Total += Position
end
Total`;
    const expected = `StartPosition = 1
ContextLimit = 3
Total = 0
for Position in (
  StartPosition till ContextLimit
)
  Total += Position
end
Total`;

    const formatted = formatSource(source, 40);
    assert.equal(formatted, expected);
    assert.equal(evaluate(source), '3');
    assert.equal(evaluate(formatted), '3');

    // Repeated formatting is stable and idempotent
    assert.equal(formatSource(formatted, 40), expected);

    // Works with REPL bindings Map
    const bindings = new Map([['StartPosition', false], ['ContextLimit', false], ['Total', false]]);
    const formattedWithBindings = formatSource(source, 40, bindings);
    assert.equal(formattedWithBindings, expected);
    assert.equal(evaluate(formattedWithBindings), '3');
});

test('formats parenthesized range expressions and multiple iterator variables in for loops (#473)', () => {
    const parenRangeSource = `StartPosition = 1
ContextLimit = 3
Total = 0
for Position in (StartPosition till ContextLimit)
  Total += Position
end
Total`;
    const formattedParen = formatSource(parenRangeSource, 40);
    assert.equal(formattedParen, `StartPosition = 1
ContextLimit = 3
Total = 0
for Position in (
  StartPosition till ContextLimit
)
  Total += Position
end
Total`);
    assert.equal(evaluate(parenRangeSource), '3');
    assert.equal(evaluate(formattedParen), '3');

    const multiBindingSource = `StartPosition = 1
ContextLimit = 3
Total = 0
for Position Index in StartPosition till ContextLimit
  Total += Position + Index
end
Total`;
    const formattedMulti = formatSource(multiBindingSource, 40);
    assert.equal(formattedMulti, `StartPosition = 1
ContextLimit = 3
Total = 0
for Position Index in (
  StartPosition till ContextLimit
)
  Total += Position + Index
end
Total`);
    assert.equal(evaluate(multiBindingSource), '4');
    assert.equal(evaluate(formattedMulti), '4');
});

test('retains original loop header if no safe line break is available within target width (#473)', () => {
    const longHeader = `for ExtremelyLongIteratorBindingVariableNameThatExceedsWidth in 1 to 10
  Total += 1
end`;
    assert.equal(formatSource(longHeader, 40), longHeader);

    const unbreakableIterable = `for Position in VeryLongIdentifierThatCannotBeBrokenIntoSmallerChunks
  Total += 1
end`;
    assert.equal(formatSource(unbreakableIterable, 40), unbreakableIterable);
});

test('preserves while-loop conditions when wrapping for statements (#473)', () => {
    const whileSource = `Count = 3
LimitValue = 100
Total = 0
for Count greater 0 and LimitValue less 1000
  Total += Count
  Count -= 1
end
Total`;
    const formattedWhile = formatSource(whileSource, 40);
    assert.equal(formattedWhile, `Count = 3
LimitValue = 100
Total = 0
for (
  Count greater 0
  and LimitValue less 1000
)
  Total += Count
  Count -= 1
end
Total`);
    assert.equal(evaluate(whileSource), '6');
    assert.equal(evaluate(formattedWhile), '6');
});
