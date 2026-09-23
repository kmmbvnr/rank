import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankSequence } from '../src/index.js';
import { run } from './support.js';

describe('Rank control flow and functions', () => {
    it('executes nested for and if blocks', () => {
        expect(run([

            'Total = 0',
            'for i in 1 to 4',
            '  if i greater 2',
            '    Total += i',
            '  end',
            'end',
            'Total',
        ].join('\n'))).toBe('7');
        expect(run([
            'Result = 0',
            'if false',
            '  Result = 1',
            'else',
            '  Result = 2',
            'end',
            'Result',
        ].join('\n'))).toBe('2');
    });

    it('discards loop values or indices with #', () => {
        expect(run([

            'Count = 0',
            'for # in 1 to 3',
            '  Count += 1',
            'end',
            'Last = 0',
            'for # i in "ab"',
            '  Last = i',
            'end',
            'Total = 0',
            'for Value # in array 2 4',
            '  Total += Value',
            'end',
            'array Count Last Total',
        ].join('\n'))).toBe('3 1 6');
    });

    it('selects the first true elif branch', () => {
        expect(run([
            'Value = 1',
            'Result = "none"',
            'if Value less 0',
            '  Result = "negative"',
            'elif Value equal 1',
            '  Result = "one"',
            'elif 1 / 0 equal 0',
            '  Result = "unreachable"',
            'else',
            '  Result = "other"',
            'end',
            'Result',
        ].join('\n'))).toBe('one');
        expect(run([
            'if false',
            '  Result = 1',
            'elif false',
            '  Result = 2',
            'else',
            '  Result = 3',
            'end',
            'Result',
        ].join('\n'))).toBe('3');
    });

    it('uses for as a condition-controlled loop', () => {
        expect(run([
            'Count = 0',
            'Total = 0',
            'for Count less 4',
            '  Total += Count',
            '  Count += 1',
            'end',
            'Total',
        ].join('\n'))).toBe('6');
    });

    it('uses bare for as an unconditional loop', () => {
        expect(run([
            'fun repeat_once Value',
            '  for',
            '    return Value',
            '  end',
            'end',
            '7 repeat_once',
        ].join('\n'))).toBe('7');
    });

    it('breaks out of the nearest for loop', () => {
        expect(run([

            'Total = 0',
            'for i in 1 to 3',
            '  for j in 1 to 3',
            '    if j equal 2',
            '      break',
            '    end',
            '    Total += 1',
            '  end',
            'end',
            'Total',
        ].join('\n'))).toBe('3');
        expect(run([
            'Count = 0',
            'for',
            '  Count += 1',
            '  break',
            'end',
            'Count',
        ].join('\n'))).toBe('1');
        expect(() => run('break'))
            .toThrowError('break is only valid inside a for loop');
    });

    it('catches typed runtime errors as values', () => {
        expect(run([
            'use text',
            'try',
            '  Value = "bad" integer',
            'catch .InvalidNumber Error',
            '  Kind = Error .Kind',
            '  Message = Error .Message',
            '  Original = Error .Value',
            '  Value = 0',
            'end',
            'Kind equal .InvalidNumber and Original equal "bad" and Value equal 0',
        ].join('\n'))).toBe('true');
    });

    it('can catch a function that reaches its end without returning', () => {
        expect(run([
            'fun fail',
            '  X = 1',
            'end',
            'try',
            '  fail',
            'catch Error',
            '  Error .Message',
            'end',
        ].join('\n'))).toBe('function fail reached end without return');
    });

    it('raises, catches and rethrows user errors', () => {
        expect(run([
            'try',
            '  try',
            '    .InvalidAge 17 raise',
            '  catch .InvalidAge Error',
            '    Error raise',
            '  end',
            'catch .InvalidAge Outer',
            '  Outer .Value',
            'end',
        ].join('\n'))).toBe('17');
        expect(run([
            'try',
            '  .Failure "could not continue" raise',
            'catch Error',
            '  Error .Message',
            'end',
        ].join('\n'))).toBe('could not continue');
        expect(() => run('.InvalidAge 17 raise'))
            .toThrowError('.InvalidAge: 17');
    });

    it('always executes finally and preserves cleanup causes', () => {
        expect(run([
            'Count = 0',
            'try',
            '  Count = 1',
            'finally',
            '  Count += 1',
            'end',
            'Count',
        ].join('\n'))).toBe('2');
        expect(run([
            'Handled = false',
            'Clean = false',
            'try',
            '  .Failure raise',
            'catch .Failure Error',
            '  Handled = true',
            'finally',
            '  Clean = true',
            'end',
            'Handled and Clean',
        ].join('\n'))).toBe('true');
        expect(run([
            'Count = 0',
            'for',
            '  try',
            '    break',
            '  finally',
            '    Count += 1',
            '  end',
            'end',
            'Count',
        ].join('\n'))).toBe('1');
        expect(run([
            'try',
            '  try',
            '    .Original "first" raise',
            '  finally',
            '    .Cleanup "second" raise',
            '  end',
            'catch .Cleanup Error',
            '  Cause = Error .Cause',
            '  Cause .Kind',
            'end',
        ].join('\n'))).toBe('.Original');
    });

    it('executes finally before returning from a function', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        const result = interpreter.execute([
            'use io',
            'fun answer Ignored',
            '  try',
            '    return 42',
            '  finally',
            '    "clean" print',
            '  end',
            'end',
            '0 answer',
        ].join('\n'));
        expect(result && formatValue(result)).toBe('42');
        expect(lines).toEqual(['clean']);
    });

    it('rejects return and break inside finally', () => {
        expect(() => run([
            'fun answer Ignored',
            '  try',
            '    return 1',
            '  finally',
            '    return 2',
            '  end',
            'end',
            '0 answer',
        ].join('\n'))).toThrowError('return is not valid inside finally');
        expect(() => run([
            'for',
            '  try',
            '    1',
            '  finally',
            '    break',
            '  end',
            'end',
        ].join('\n'))).toThrowError('break is not valid inside finally');
    });

    it('does not catch return or break as errors', () => {
        expect(run([
            'fun answer Ignored',
            '  try',
            '    return 42',
            '  catch Error',
            '    return 0',
            '  end',
            'end',
            '0 answer',
        ].join('\n'))).toBe('42');
        expect(run([
            'Count = 0',
            'for',
            '  try',
            '    break',
            '  catch Error',
            '    Count = 99',
            '  end',
            'end',
            'Count',
        ].join('\n'))).toBe('0');
    });

    it('calls user functions with local indexes and returns arrays', () => {
        expect(run([
            'use algo',
            'fun two_sum A Target',
            '  for Value i in A',
            '    Need = Target - Value',
            '    if Need in index',
            '      J = index Need',
            '      return array J i',
            '    end',
            '    index Value = i',
            '  end',
            'end',
            'A = array 2 7 11 15',
            'Answer = A 9 two_sum',
            'Answer 1',
        ].join('\n'))).toBe('1');
    });

    it('registers top-level functions before executing the file', () => {
        expect(run([
            'Answer = 41 next',
            'fun next X',
            '  return X + 1',
            'end',
            'Answer',
        ].join('\n'))).toBe('42');

        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/example_test.ra',
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: [
                    'TopLevel = 99',
                    'fun next X',
                    '  return X + 1',
                    'end',
                ].join('\n'),
            }),
        });
        expect(interpreter.execute('use "worker"\n41 next')).toBe(42n);
        expect(interpreter.variables.has('TopLevel')).toBe(false);
    });

    it('registers local functions early and captures their lexical workspace', () => {
        expect(run([
            'fun total N',
            '  return N adddown',
            '',
            '  fun adddown Value',
            '    if Value equal 0',
            '      return 0',
            '    end',
            '    return Value + ((Value - 1) adddown)',
            '  end',
            'end',
            '5 total',
        ].join('\n'))).toBe('15');

        expect(run([
            'fun make Base',
            '  return add',
            '',
            '  fun add Value',
            '    Base += 1',
            '    return Base + Value',
            '  end',
            'end',
            'A = 10 make',
            'B = 20 make',
            'First = 0 A',
            'Second = 0 A',
            'Other = 0 B',
            'array First Second Other',
        ].join('\n'))).toBe('11 12 21');
    });

    it('uses lexical rather than caller-local function lookup', () => {
        expect(() => run([
            'fun caller X',
            '  return 1 helper',
            'end',
            'fun helper Y',
            '  return X + Y',
            'end',
            '3 caller',
        ].join('\n'))).toThrowError('unknown name: X');
    });

    it('keeps captured local generators alive after their outer call', () => {
        expect(run([

            'fun multiples Factor',
            '  return values',
            '',
            '  fun values Limit',
            '    for Value in 1 to Limit',
            '      yield Value * Factor',
            '    end',
            '  end',
            'end',
            'Twos = 2 multiples',
            '3 Twos array',
        ].join('\n'))).toBe('2 4 6');
    });

    it('reevaluates prepared loop sources and assignments on each call', () => {
        expect(run([
            'fun total Values',
            '  Sum = 0',
            '  for Value i in Values',
            '    Sum += Value + i',
            '  end',
            '  return Sum',
            'end',
            'A = array 2 3',
            'First = A total',
            'A 0 = 10',
            'Second = A total',
            'B = array 7',
            'array First Second (B total)',
        ].join('\n'))).toBe('6 14 7');
    });

    it('preserves catch and finally across prepared generator commands', () => {
        expect(run([

            'fun values Base',
            '  try',
            '    for I in 0 until 2',
            '      yield Base + I',
            '    end',
            '    .Failure raise',
            '  catch .Failure Error',
            '    yield Base + 2',
            '  finally',
            '    yield Base + 3',
            '  end',
            'end',
            'A = 10 values array',
            'B = 20 values array',
            '(A equal (array 10 11 12 13)) and (B equal (array 20 21 22 23))',
        ].join('\n'))).toBe('true true true true');
    });

    it('prepares operands only when execution reaches them', () => {
        expect(run([
            'fun fail N',
            '  .First raise',
            '  return N',
            'end',
            'try',
            '  Answer = (0 fail) (1 abs rank Bad)',
            'catch .First Error',
            '  true',
            'end',
        ].join('\n'))).toBe('true');
    });

    it('allocates arrays afresh when executing the same function body', () => {
        expect(run([
            'fun make Value',
            '  Data = array shape 2 fill Value',
            '  return Data',
            'end',
            'A = 1 make',
            'B = 2 make',
            'A 0 = 9',
            'array (A 0) (A 1) (B 0) (B 1)',
        ].join('\n'))).toBe('9 1 2 2');
    });

    it('restores the caller frame after a captured function raises', () => {
        expect(run([
            'fun make Base',
            '  return fail',
            '  fun fail N',
            '    Base += N',
            '    .Failure Base raise',
            '    return 0',
            '  end',
            'end',
            'fun caller N',
            '  F = N make',
            '  try',
            '    1 F',
            '  catch .Failure Error',
            '    N += 10',
            '  end',
            '  return N',
            'end',
            'array (2 caller) (5 caller)',
        ].join('\n'))).toBe('12 15');
    });

    it('keeps frames separate when generators from the same body interleave', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun values Base',
            '  yield Base',
            '  Base += 1',
            '  yield Base',
            'end',
            'A = 10 values',
            'B = 20 values',
        ].join('\n'));
        const a = interpreter.variables.get('A')!;
        const b = interpreter.variables.get('B')!;
        if (!isRankSequence(a) || !isRankSequence(b)) throw new Error('expected sequences');
        const left = a.plan.iterate();
        const right = b.plan.iterate();
        expect(left.next().value).toBe(10n);
        expect(right.next().value).toBe(20n);
        expect(left.next().value).toBe(11n);
        expect(right.next().value).toBe(21n);
        expect(left.next().done).toBe(true);
        expect(right.next().done).toBe(true);
        interpreter.dispose();
    });

    it('rejects conditional local function declarations', () => {
        expect(() => run([
            'fun outer Enabled',
            '  if Enabled',
            '    fun inner Value',
            '      return Value',
            '    end',
            '  end',
            '  return 0',
            'end',
            'true outer',
        ].join('\n'))).toThrowError(
            'a local function must be declared directly inside a function',
        );
    });

    it('keeps a source function attached to its module vocabulary', () => {
        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/example_test.ra',
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: [
                    'use text',
                    'fun pieces Text',
                    '  return Text "," split',
                    'end',
                ].join('\n'),
            }),
        });
        expect(interpreter.execute('use "worker"\n"a,b" pieces')).toEqual({
            kind: 'array',
            items: ['a', 'b'],
            shape: [2],
        });
    });

});
