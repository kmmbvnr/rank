import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { analyzeValues, createRankServices, functionSignature, isFunctionStatement, type Program } from '../src/index.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function signature(source: string, name: string, arguments_?: NonNullable<Parameters<typeof functionSignature>[1]>['arguments']) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const definition = parsed.value.statements.find(node => isFunctionStatement(node) && node.name === name);
    if (!isFunctionStatement(definition)) throw new Error('missing function');
    const analysis = analyzeValues(parsed.value, new Map(), new Map(), arguments_ ? [{ name, arguments: arguments_ }] : []);
    return functionSignature(definition, { arguments: arguments_, result: analysis.functionResults[0],
        relationship: analysis.relationships.get(definition) });
}

it('displays identity and tuple relationships with unknown inputs', () => {
    expect(signature('fun Value identity\n return Value\nend', 'identity')).toBe('a → a');
    expect(signature('fun Value pair\n return tuple Value "label"\nend', 'pair')).toBe('a → tuple(a, text)');
    expect(signature('fun Left Right pair\n return tuple Left Right\nend', 'pair')).toBe('a b → tuple(a, b)');
});

it('retains relationships through composed helpers', () => {
    expect(signature('fun Value pair\n return tuple Value "label"\nend\nfun Input wrap\n return Input pair\nend', 'wrap'))
        .toBe('a → tuple(a, text)');
});

it('uses example types without guessing unconstrained arithmetic domains', () => {
    const source = 'fun Value twice\n return Value + Value\nend';
    expect(signature(source, 'twice')).toBe('a → a ; c<a> → c<a> ; a: number');
    expect(signature(source, 'twice', [{ types: ['integer'], rank: 0, shape: [] }])).toBe('i → i');
    expect(signature(source, 'twice', [{ types: ['array'], rank: 2, shape: [2, 3], elements: ['real'], callbackFreeScalarCells: true }]))
        .toBe("c[2, 3]<r> → c[2, 3]<r>");
});

it('does not mistake an unknown field requirement for a known field result', () => {
    const source = 'fun State items\n return State .items\nend';
    expect(signature(source, 'items')).toBe('a → ?');
    expect(signature(source, 'items', [{ types: ['record'], fields: { items: { types: ['text'], rank: 1, shape: [null] } } }]))
        .toBe('record → text');
});

it('displays proven literals independently of unknown operands', () => {
    expect(signature('fun Ignored answer\n return 42\nend', 'answer')).toBe('a → i');
    expect(signature('fun answer\n return 42\nend', 'answer')).toBe('→ i');
});

it('retains ordinary result facts when a relationship cannot prove reader safety', () => {
    expect(signature('fun Value twice\n return Value * 2\nend', 'twice', [
        { types: ['array'], rank: 1, shape: [3], elements: ['integer'] },
    ])).toBe("c[3]<i> → c[3]<?>");
});

it('infers generator locals across branches and loop back edges', () => {
    const source = `fun N facts
 Rest = N
 D = 2
 Step = 1
 for Rest greater 1
  if D greater (Rest // D)
   yield Rest
  end
  if Rest mod D equal 0
   yield D
   Rest = Rest // D
  else
   D += Step
   Step = 2
  end
 end
end`;
    expect(signature(source, 'facts')).toBe("i → c<i>");
});

it('does not advertise incompatible generator writes or heterogeneous cells', () => {
    expect(signature('fun N f\n X = 1\n for N greater 0\n  yield X\n  X = X / 2\n  N -= 1\n end\nend', 'f'))
        .toBe("a → c");
    expect(signature('fun N f\n if N greater 0\n  X = 1\n else\n  X = 1.5\n end\n yield X\nend', 'f'))
        .toBe("a → c");
    expect(signature('fun N f\n for N greater 0\n  X = 1\n  N -= 1\n end\n yield X\nend', 'f')).toBe("a → c");
    expect(signature('fun N f\n yield N unknown_helper\nend', 'f')).toBe("a → c");
    expect(signature('fun N f\n yield 1.0\nend', 'f')).toContain("i → c<r>");
});

it('keeps concrete four-argument inference independent of the symbolic body preview', () => {
    const source = 'fun A B C D sum4\n return ((A + B) + C) + D\nend';
    const value = (type: 'integer' | 'real') => ({ types: [type], rank: 0, shape: [] });
    expect(signature(source, 'sum4')).toContain('a a a a → a');
    expect(signature(source, 'sum4').match(/a: number/g)).toHaveLength(1);
    expect(signature(source, 'sum4', Array(4).fill(value('integer'))))
        .toBe('i i i i → i');
    expect(signature(source, 'sum4', Array(4).fill(value('real'))))
        .toBe('r r r r → r');
    expect(signature(source, 'sum4', [value('integer'), value('real'), value('integer'), value('integer')]))
        .toBe('i r i i → r');
});


it('keeps the result unknown when unsupported fields exhaust inference', () => {
    const source = 'fun A B C D f\n return A .value + ((B + C) + D)\nend';
    expect(signature(source, 'f')).toBe('a b d e → ?');
    expect(signature('fun A B f\n return A .value + B\nend', 'f')).toBe('a b → ?');
    expect(signature(source, 'f', [
        { types: ['record'], fields: { value: { types: ['integer'], rank: 0, shape: [] } } },
        ...Array.from({ length: 3 }, () => ({ types: ['integer'], rank: 0, shape: [] })),
    ])).toBe('record i i i → i');
});


it('shows the collection result element separately from its preserved container kind', () => {
    expect(signature('fun X half\n return X / 2\nend', 'half'))
        .toBe('a → r ; c<a> → c<r> ; a: number');
});


it('renders backward parameter contracts without inventing a collection-only sum input', () => {
    const source = 'fun Numbers Digits leading_sum\n Total = Numbers sum\n Text = Total text\n Prefix = Text take Digits\n return Prefix integer\nend';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    const definition = parsed.value.statements.find(isFunctionStatement)!;
    const analysis = analyzeValues(parsed.value, new Map(), new Map(), [{ name: 'leading_sum', arguments: [{ types: [] }, { types: [] }] }]);
    const requirements = analysis.requirements.functions.get(definition)!.params;
    expect(functionSignature(definition, { requirements, result: analysis.functionResults[0] }))
        .toBe('(number | missing) [rank ≥ 0] i → i');
    expect(functionSignature(definition, { requirements, result: { types: ['integer'], rank: 0, shape: [] },
        arguments: [{ types: ['integer'], rank: 0, shape: [] }, { types: ['integer'], rank: 0, shape: [] }] }))
        .toBe('i i → i');
});
