import { compiledOperators, operations, compiledCallSignatures } from '@arrrank/language';

export interface CapabilityCase {
    id: string;
    source: string;
    inputs: string[];
    result: string;
    ranks: number[];
    layout: string;
    effects: string[];
    combination: string;
    storage?: 'int32' | 'int64' | 'float64';
    operator?: string;
    error?: true;
}
const samples: Record<string, string> = { integer: '3', real: '2.5', boolean: 'true', text: '"λ"', bytes: '"λ" bytes' };
const spelling: Record<string, string> = { atmost: 'at most', atleast: 'at least', notequal: 'not equal' };
export const cases: CapabilityCase[] = [];
// Every advertised loop signature is exercised in a real program. The report
// also retains other backend declarations, without treating them as evidence.
for (const op of compiledOperators) for (const [index, signature] of op.integerLoop.entries()) {
    const operands = signature.inputs.map(type => samples[type]);
    const word = spelling[op.name] ?? op.name;
    const expression = operands.length === 1 ? `${word} ${operands[0]}` : `${operands[0]} ${word} ${operands[1]}`;
    cases.push({ id: `operator/${op.name}/${index}`, operator: op.name,
        source: `Result = ${samples[signature.result]}\nfor I in 1 to 2\n Result = ${expression}\nend\nResult`,
        inputs: [...signature.inputs], result: signature.result, ranks: signature.inputs.map(() => 0),
        layout: 'scalar', effects: [], combination: 'operator in loop' });
}
function add(id: string, source: string, inputs: string[], result: string, ranks = [0], layout = 'scalar', effects: string[] = [], error?: true) {
    cases.push({ id, source, inputs, result, ranks, layout, effects, combination: id, error });
}
add('scalar/helper', 'fun X square\n return X * X\nend\n12 square', ['integer'], 'integer');
add('guard/exactness', 'fun X square\n return X * X\nend\n100000000 square', ['integer'], 'integer');
add('guard/array', 'Values = 1 to 8\nMask = Values mod 3 equal 0\nValues Mask sum', ['integer[]'], 'integer', [1], 'lazy range and mask');
add('lowering/range', 'Values = 1 till 8\nValues sum', ['integer'], 'integer', [1], 'lazy range');
add('cost/statements', 'Total = 0\nfor I in 1 to 2\n' + ' Total += I\n'.repeat(129) + 'end\nTotal', ['integer'], 'integer');
add('error/type-change', 'Value = 1\nValue = "text"\nValue', ['integer', 'text'], 'error', [0], 'scalar', [], true);
add('error/zero-divisor', 'Value = 0\n3 // Value', ['integer', 'integer'], 'error', [0], 'scalar', [], true);
add('array/dense', 'Values = array 1 2 3\nValues sum', ['integer[]'], 'integer', [1], 'dense');
add('array/matrix', 'Values = array shape 2 2 fill 3\nValues sum', ['integer[]'], 'array', [2], 'dense');
add('array/write-alias', 'Values = array 1 2 3\nAlias = Values\nValues 0 = 7\nAlias sum', ['integer[]'], 'integer', [1], 'copy-on-write', ['mutates']);
add('array/empty', 'Values = array shape 0 fill 0\nValues sum', ['integer[]'], 'integer', [1], 'empty');
add('array/real', 'Values = array 1.5 2.5 3.5\nValues sum', ['real[]'], 'real', [1], 'dense');
add('array/text', 'Values = array "a" "b"\nValues len', ['text[]'], 'integer', [1], 'boxed');
add('effects/print', 'use io\nfor I in 1 to 3\n I print\nend\n7', ['integer'], 'integer', [0], 'scalar', ['io']);
add('function/capture', 'Offset = 3\nfun X shifted\n return X + Offset\nend\n4 shifted', ['integer'], 'integer');
add('function/branch', 'fun X absolute\n if X less 0\n  return -X\n end\n return X\nend\n(-3) absolute', ['integer'], 'integer');
add('loop/control', 'Total = 0\nfor I in 1 to 8\n if I equal 2\n  continue\n elif I equal 5\n  break\n end\n Total += I\nend\nTotal', ['integer'], 'integer');
add('lazy/binding', "Values' = 1 to 8\nSquares' = Values * Values\nSquares sum", ['integer[]'], 'integer', [1], 'deferred');

const domains: Record<string, string[]> = {
    number: ['integer', 'real'], scalar: ['integer', 'real', 'boolean', 'text'],
    'text-or-bytes': ['text', 'bytes'], 'text-or-array': ['text', 'integer-array', 'text-array'],
};
const builtinSamples: Record<string, string> = { ...samples, integer: '1', real: '1.0', text: '"1"',
    'integer-array': '(array 1 2 3)', 'text-array': '(array "1" "2")' };
for (const op of operations) for (const [index, signature] of compiledCallSignatures(op).entries()) {
    let variants: string[][] = [[]];
    for (const domain of signature.inputs) variants = variants.flatMap(prefix =>
        (domain === 'same' ? [prefix[0]] : domains[domain] ?? [domain]).map(type => [...prefix, type]));
    for (const types of variants) {
        const args = types.map(type => `(${builtinSamples[type]})`);
        if (op.name === 'atanh') args[0] = types[0] === 'integer' ? '0' : '0.5';
        const expression = args.length === 2
            ? `${args[0]} ${op.name} ${args[1]}` : `${args.join(' ')} ${op.name}`;
        add(`builtin/${op.name}/${index}/${types.join(',')}`,
            `${op.module === 'core' ? '' : `use ${op.module}\n`}Result = ${samples[signature.result]}\nfor I in 1 to 2\n Result = ${expression}\nend\nResult`,
            types, signature.result, types.map(type => type.endsWith('-array') ? 1 : 0),
            types.some(type => type.endsWith('-array')) ? 'dense' : 'scalar');
    }
}

add('array/view', 'use sequences\nValues = 1 to 20 array\nIndices = 3 till 9 array\nView = Values Indices\nView sum', ['integer[]'], 'integer', [1], 'contiguous view');
add('array/strided', 'Values = array 1 2 3 4 5 6 shape 2 3\nColumn = Values # 1\nColumn sum', ['integer[]'], 'integer', [2], 'strided column');
add('array/ranked', 'Values = array 1 2 3 4 5 6 shape 2 3\nValues sum rank 1', ['integer[]'], 'integer[]', [2, 1], 'ranked rows');
add('array/rows', 'Values = array shape 2 2\n 1 2\n 3 4\nend\nValues sum', ['integer[]'], 'integer[]', [2], 'dense');
add('record/update', 'State = record\n .count = 2\nend\nNext = State with\n .count += 3\nend\nNext .count', ['record'], 'integer');
add('tuple/unpack', 'Pair = tuple 2 3\nunpack Left Right = Pair\nLeft + Right', ['tuple'], 'integer');
add('effects/catch-finally', 'use io\ntry\n 3 // 0\ncatch Error\n "caught" print\nfinally\n "finally" print\nend\n7', ['integer'], 'integer', [0], 'scalar', ['io', 'exception']);
add('function/binding', 'fun X twice\n return X * 2\nend\nother = twice\n3 other', ['integer'], 'integer');
add('selection/first', 'Values = 1 to 8\nValues first where greater 3', ['integer[]'], 'integer', [1], 'lazy');
add('error/removed-take-while', 'Values = 1 to 8\nPrefix = Values take while less 4\nPrefix sum', ['integer[]'], 'error', [1], 'lazy', [], true);
add('selection/till', 'Values = 1 to 8\nPrefix = Values till greater 3\nPrefix sum', ['integer[]'], 'integer', [1], 'lazy');
add('text/block', 'Text = text\n "hello"\n "world"\nend\nText len', ['text'], 'integer');
// Exercise each declared scalar signature in its own helper as well as in a
// surrounding loop. Different backend paths remain separate matrix rows.
for (const op of compiledOperators) for (const [index, signature] of op.scalarFunction.entries()) {
    const names = ['Left', 'Right'].slice(0, signature.inputs.length);
    const word = spelling[op.name] ?? op.name;
    const expression = names.length === 1 ? `${word} ${names[0]}` : `${names[0]} ${word} ${names[1]}`;
    cases.push({ id: `helper-operator/${op.name}/${index}`,
        source: `fun ${names[0]} probe ${names[1] ?? ''}\n return ${expression}\nend\n(${samples[signature.inputs[0]]}) probe ${signature.inputs[1] ? `(${samples[signature.inputs[1]]})` : ''}`,
        inputs: [...signature.inputs], result: signature.result, ranks: signature.inputs.map(() => 0),
        layout: 'scalar', effects: [], combination: 'operator in helper' });
}
for (const op of compiledOperators) for (const [index, signature] of (op.tensor ?? []).entries()) {
    const names = ['Left', 'Right'].slice(0, signature.inputs.length);
    const word = spelling[op.name] ?? op.name;
    const expression = names.length === 1 ? `${word} ${names[0]}` : `${names[0]} ${word} ${names[1]}`;
    cases.push({ id: `tensor-operator/${op.name}/${index}`,
        source: `${signature.inputs.map((type, i) => `${names[i]} = array shape 8 fill ${samples[type]}`).join('\n')}\nResult = (${expression}) array\nResult`,
        inputs: signature.inputs.map(type => `${type}[]`), result: `${signature.result}[]`, ranks: signature.inputs.map(() => 1),
        layout: 'dense', effects: [], combination: 'operator and materialization' });
}
for (const type of ['integer', 'real', 'boolean', 'text']) add(`effects/set/${type}`,
    `use algo\nSeen = new set\nfor I in 1 to 3\n Seen add (${samples[type]})\nend\nSeen len`,
    ['set', type], 'integer', [0], 'set', ['mutates']);
add('effects/graph', 'use algo\nuse graph\nSeen = new set\nGraph = new graph .directed\nfor I in 1 to 4\n Seen add I\n Graph add 0 I\nend\nSeen sum', ['graph', 'set', 'integer'], 'integer', [0], 'containers', ['mutates']);
add('array/rank-three', 'Values = array shape 2 2 2 fill 3\nValues sum rank 3', ['integer[]'], 'integer', [3], 'dense');
for (const op of compiledOperators) for (const [index, signature] of (op.scalarExpression ?? []).entries()) {
    const names = ['Left', 'Right'].slice(0, signature.inputs.length);
    const word = spelling[op.name] ?? op.name;
    const expression = names.length === 1 ? `${word} ${names[0]}` : `${names[0]} ${word} ${names[1]}`;
    cases.push({ id: `expression-operator/${op.name}/${index}`,
        source: `${signature.inputs.map((type, i) => `${names[i]} = ${samples[type]}`).join('\n')}\nResult = ${expression}\nResult`,
        inputs: [...signature.inputs], result: signature.result, ranks: signature.inputs.map(() => 0),
        layout: 'scalar', effects: [], combination: 'operator in assignment' });
}
add('selection/from-take', 'Values = 1 to 8\nPart = Values from greater 2 take 3\nPart sum', ['integer[]'], 'integer', [1], 'lazy');
add('selection/first-index', 'Values = 1 to 8\nValues first index where greater 3', ['integer[]'], 'integer', [1], 'lazy');
add('function/declared', 'fun X scale .by Factor=2\n return X * Factor\nend\n3 scale by 4', ['integer', 'integer'], 'integer');
add('function/operator', 'fun X Y fold op .with Seed=1\n return (X op Y) + Seed\nend\n3 4 fold + with 2', ['integer', 'integer', 'function'], 'integer');
add('array/unpack-shape', 'use sequences\nValues = array 1 2 3 4\nShape = array 2 2\nValues reshape unpack Shape', ['integer[]', 'integer[]'], 'integer[]', [1, 2], 'reshape');
add('container/push', 'use algo\nValues = new deque\nValues push 3\nValues push 4\nValues sum', ['deque', 'integer'], 'integer', [1], 'deque', ['mutates']);
const rows = `use json\nuse tables\nuse sequences\nRows = ${JSON.stringify(JSON.stringify([{ id: 1, score: 10 }, { id: 2, score: 20 }]))} json\n`;
add('table/filter-select', rows + 'Result = (Rows filter .id greater 1) select\n Double = .score * 2\n .value = Double\nend\nResult .value', ['record[]'], 'integer[]', [1], 'records');
add('table/sort', rows + 'Result = Rows sort by .score .descending\nResult .id', ['record[]'], 'integer[]', [1], 'records');
add('table/group', rows + 'Groups = Rows group by .id\nResult = Groups select\n .total = .score sum\nend\nResult .total', ['record[]'], 'integer[]', [1], 'records');
add('table/join', rows + 'Keys = Rows select .id\nResult = Rows Keys innerjoin by .id\nResult .id', ['record[]', 'record[]'], 'integer[]', [1], 'records');

for (const storage of ['int32', 'int64', 'float64'] as const) for (const selection of ['dense', 'strided']) {
    cases.push({ id: `storage/${storage}/${selection}`, storage,
        source: selection === 'dense' ? 'Result = Values sum rank 2\nResult'
            : 'Column = Values # 1\nColumn sum',
        inputs: [storage === 'float64' ? 'real[]' : 'integer[]'], result: storage === 'float64' ? 'real' : 'integer',
        ranks: [2], layout: `${storage} ${selection}`, effects: [], combination: 'stored input and reduction' });
}

// Function extraction, ranked cells and higher-order forwarding use the same inputs.
for (const rank of ['', ' rank 0', ' rank 1', ' rank -1']) {
    add(`composition/named${rank.replace(/ /g, '-') || '-plain'}`,
        `fun X square${rank}\n return X * X\nend\nfun X helper\n return (X square) + 1\nend\n3 helper`, ['integer'], 'integer');
}
const square = 'fun X square\n return X * X\nend\n';
const apply = 'fun X apply op\n return (X op) + 1\nend\n';
add('composition/callable', square + apply + '3 apply square', ['integer', 'function'], 'integer');
add('composition/forwarded-callable', square + apply + 'fun X forward op\n return (X apply op) + 1\nend\n3 forward square', ['integer', 'function'], 'integer');
add('composition/nested-callable-capture', apply + 'fun Offset outer\n fun X shifted\n  return X + Offset\n end\n return 3 apply shifted\nend\nFirst = 4 outer\nSecond = 10 outer\nFirst + Second', ['integer', 'function'], 'integer');
add('composition/recursive-callable', square + 'fun Count total op\n if Count equal 0\n  return 0\n end\n return (Count op) + ((Count - 1) total op)\nend\n4 total square', ['integer', 'function'], 'integer');
add('composition/mutual-recursion-boundary', 'fun X even\n if X equal 0\n  return true\n end\n return (X - 1) odd\nend\nfun X odd\n if X equal 0\n  return false\n end\n return (X - 1) even\nend\n10 even', ['integer'], 'boolean');
add('composition/nested-body-boundary', 'fun X helper\n fun Y shifted\n  return X + Y\n end\n return 3 shifted\nend\n4 helper', ['integer'], 'integer');
for (const size of [0, 3]) add(`composition/ranked-array-result-${size}`,
    `use sequences\nfun X pair rank 0\n return array X (X + 1)\nend\nValues = array shape ${size} fill 3\nResult = Values pair\nResult shape`, ['integer[]'], 'integer[]', [1, 2], 'ranked cells');

add('composition/mutual-nontail-framed', 'fun N first\n if N equal 0\n  return 0\n end\n return ((N - 1) second) + 1\nend\nfun N second\n if N equal 0\n  return 0\n end\n return ((N - 1) first) + 1\nend\n10 first', ['integer'], 'integer');
add('composition/nested-branch-framed', 'fun Offset outer\n fun X shifted\n  return X + Offset\n end\n if Offset greater 0\n  Result = 3 shifted\n  return Result + 1\n else\n  return 0\n end\nend\n4 outer', ['integer'], 'integer');
add('composition/nested-array-framed', 'use sequences\nfun Offset outer\n fun X pair\n  return array X (X + Offset)\n end\n Values = 3 pair\n Before = Values copy\n Values 0 = 9\n return array (Before sum) (Values sum)\nend\n4 outer', ['integer'], 'integer[]', [0, 1], 'owned array', ['write']);

add('values/record-helper', 'fun State change\n Next = State with\n  .count += 1\n end\n return Next\nend\nState = record\n .count = 2\nend\nNext = State change\ntuple (State .count) (Next .count)', ['record'], 'tuple');
add('values/nested-fields', 'fun State change\n Child = State .child\n Child .count += 1\n return State .child .count\nend\nState = record\n .child = record\n  .count = 2\n end\nend\nState change', ['record'], 'integer', [0], 'nested record', ['write']);
add('values/tuple-result', 'fun N pair\n return tuple N "ok"\nend\nfun N consume\n unpack Count Name = N pair\n return tuple Count Name\nend\n3 consume', ['integer'], 'tuple');
add('values/text-queue', 'use algo\nfun Store append Value\n Store push Value\n return Store\nend\nfun Store takeitem\n return Store pop\nend\nStore = new queue\nAlias = Store append "hello"\nAlias takeitem', ['queue', 'text'], 'text', [0], 'queue', ['write']);
add('values/record-set', 'use algo\nfun Store includeitem Value\n Store add Value\n return Store\nend\nStore = new set\nValue = record\n .count = 2\nend\nAlias = Store includeitem Value\nAlias len', ['set', 'record'], 'integer', [0], 'set', ['write']);
add('values/mixed-index', 'use algo\nfun Store populate\n Store "count" = 3\n Store "name" = "Ada"\n return Store\nend\nStore = new index\nAlias = Store populate\ntuple (Alias "count") (Alias "name")', ['index'], 'tuple', [0], 'index', ['write']);
add('values/record-type-error', 'State = record\n .count = 2\nend\nState .count = "bad"', ['record'], 'error', [0], 'record', ['write'], true);
add('values/record-loop', 'State = record\n .count = 0\nend\nfor I in 1 to 3\n State .count += I\nend\nState .count', ['record'], 'integer', [0], 'record', ['write']);
