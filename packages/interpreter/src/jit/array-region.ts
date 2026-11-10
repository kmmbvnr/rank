import { observeCompiler, observedRun, declineCompiler, withCompilerMethods } from '../compiler-observation.js';
import { AstUtils } from 'langium';
import {
    flattenApplication, isAssignmentStatement, isArrayAssignmentStatement, isNameExpression,
    isNumberLiteral, isParenthesizedExpression, isBinaryExpression, isUnaryExpression,
    isApplicationExpression, isUnpackStatement, statementResultDiscarded, type Expression, type Statement, type ArrayAssignmentStatement,
} from '@arrrank/language';
import { arrayRevision, denseScalarItems, storedScalarKinds, integer32Cells, integer64Cells, typedArray } from '../array-storage.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';
import { checkpoint, privateLoopPolling, inspectionEnabled } from '../interrupt.js';

type Node = { id: number; kind: 'input' | 'literal' | 'binary' | 'range' | 'select' | 'choose';
    name?: string; value?: bigint; op?: string; children: Node[] };
const decline = {};
function rejectRegion(reason: string): never { declineCompiler(reason); throw decline; }
const lowWord = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1;
const highWord = 1 - lowWord;
const checked = (x: number) => { if (!Number.isSafeInteger(x)) rejectRegion('unsafe-integer'); return x; };
function calculate(op: string, a: number, b: number): number | boolean {
    if (op === '+') return checked(a + b);
    if (op === '-') return checked(a - b);
    if (op === '*') return checked(a * b);
    if (op === 'min') return b < a ? b : a;
    if (op === 'max') return b > a ? b : a;
    if (op === 'less') return a < b;
    if (op === 'greater') return a > b;
    if (op === 'atmost') return a <= b;
    if (op === 'atleast') return a >= b;
    if (op === 'equal') return a === b;
    if (op === 'notequal') return a !== b;
    if (!b) rejectRegion('zero-divisor-guard');
    const r = a % b;
    if (op === 'mod') return r && (r < 0) !== (b < 0) ? r + b : r;
    return checked((a - r) / b) - ((a < 0) !== (b < 0) && r !== 0 ? 1 : 0);
}
const merged = (a: number, b: number) => {
    if (a < 0) return b;
    if (b < 0 || a === b) return a;
    if (a === 1) return b;
    if (b === 1) return a;
    rejectRegion('broadcast-shape-guard');
};
const operators = ['+', '-', '*', '//', 'mod', 'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal'];

type Kernel = (a: Int32Array[], s: (number | boolean)[], z: number[], steps: number[],
    out: Int32Array | Float64Array, first: number, stride: number, n: number, narrow: boolean) => number;
export interface ArrayRegion {
    length: number; locals: string[]; inputs: string[]; builtins: string[]; target: string;
    consumer: ArrayAssignmentStatement;
    /** Borrowed output: consume synchronously before the next run. */
    run(values: RankValue[]): { value: RankArray; first: bigint; step: bigint; count: number } | undefined;
}

/** A pure chain may disappear only when its names cannot be observed outside
 * the consumer. Guard failures replay the original statements before any write. */
export function compileArrayRegion(commands: readonly Statement[], start: number): ArrayRegion | undefined {
    const candidate = observeCompiler(commands[start], 'array-region', 'prepare', () => compileArrayRegionObservedImplementation(commands, start));
    return candidate && withCompilerMethods(candidate, { run: observedRun(commands[start], 'array-region', candidate.run.bind(candidate)) });
}

function compileArrayRegionObservedImplementation(commands: readonly Statement[], start: number): ArrayRegion | undefined {
    const nodes: Node[] = [], inputs = new Map<string, Node>(), definitions = new Map<string, Node>();
    const builtins = new Set<string>();
    const make = (kind: Node['kind'], children: Node[] = [], extra: Partial<Node> = {}): Node => {
        const node = { id: nodes.length, kind, children, ...extra }; nodes.push(node); return node;
    };
    const input = (name: string) => {
        let node = inputs.get(name);
        if (!node) inputs.set(name, node = make('input', [], { name }));
        return node;
    };
    function parse(e: Expression, depth = 0): Node | undefined {
        if (depth > 64 || nodes.length > 128) return declineCompiler('expression-budget', e);
        while (isParenthesizedExpression(e)) e = e.value;
        if (isNumberLiteral(e) && typeof e.value === 'bigint') return make('literal', [], { value: e.value });
        if (isNameExpression(e) && !e.name.includes('.')) return definitions.get(e.name) ?? input(e.name);
        if (isUnaryExpression(e) && e.operator === '-') {
            const right = parse(e.operand, depth + 1);
            return right && make('binary', [make('literal', [], { value: 0n }), right], { op: '-' });
        }
        if (isBinaryExpression(e) && (operators.includes(e.operator) || ['to', 'till'].includes(e.operator))) {
            const a = parse(e.left, depth + 1), b = parse(e.right, depth + 1);
            if (!a || !b) return undefined;
            if (e.operator === 'to' || e.operator === 'till') {
                const step = e.step ? parse(e.step, depth + 1) : make('literal', [], { value: 1n });
                return step && make('range', [a, b, step], { op: e.operator });
            }
            return !e.step ? make('binary', [a, b], { op: e.operator }) : undefined;
        }
        if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), word = parts.at(-1);
            if (word && isNameExpression(word) && !definitions.has(word.name)
                && (['min', 'max'].includes(word.name) && parts.length === 3 || word.name === 'choose' && parts.length === 4)) {
                const args = parts.slice(0, -1).map(part => parse(part, depth + 1));
                if (!args.every((node): node is Node => !!node)) return undefined;
                builtins.add(word.name);
                return make(word.name === 'choose' ? 'choose' : 'binary', args, { op: word.name });
            }
            if (parts.length === 2 && isNameExpression(parts[0]) && !definitions.has(parts[0].name)) {
                const selector = parse(parts[1], depth + 1);
                return selector && make('select', [input(parts[0].name), selector]);
            }
        }
        return declineCompiler('unsupported-expression', e);
    }
    let consumer: ArrayAssignmentStatement | undefined, end = start;
    for (; end < Math.min(commands.length, start + 16); end++) {
        const statement = commands[end];
        if (isArrayAssignmentStatement(statement)) { consumer = statement; break; }
        if (!isAssignmentStatement(statement) || statement.operator !== '=' || statement.deferred
            || statement.name.includes('.') || definitions.has(statement.name)) return declineCompiler('private-assignment-chain-required', statement);
        const node = parse(statement.value);
        if (!node) return undefined;
        definitions.set(statement.name, node);
    }
    if (!consumer) return declineCompiler('array-write-consumer-required', commands[start]);
    if (definitions.size < 2) return declineCompiler('too-small', consumer);
    if (consumer.accumulate || consumer.modulus) return declineCompiler('unsupported-write-modifier', consumer);
    if (consumer.name.includes('.') || definitions.has(consumer.name)) return declineCompiler('unstable-target-binding', consumer);
    if (!['=', '+=', '-=', '*='].includes(consumer.operator)) return declineCompiler('unsupported-write-operator', consumer);
    if (consumer.indices.length !== 1 || consumer.indices[0].sign || consumer.indices[0].all
        || !consumer.indices[0].value) return declineCompiler('single-vector-index-required', consumer);
    if (!statementResultDiscarded(consumer)) return declineCompiler('escaping-write-result', consumer);
    const selector = parse(consumer.indices[0].value), rhs = parse(consumer.value), target = input(consumer.name);
    if (!selector || !rhs) return undefined;
    const reachable = new Set<Node>();
    const visit = (node: Node) => { if (!reachable.has(node)) { reachable.add(node); node.children.forEach(visit); } };
    visit(selector); visit(rhs);
    if ([...definitions.values()].some(node => !reachable.has(node))) return declineCompiler('unused-binding-may-throw', consumer);
    const locals = [...definitions.keys()];
    // Before/after reads include captures in nested functions and branches.
    for (const statement of [...commands.slice(0, start), ...commands.slice(end + 1)]) {
        if ([statement, ...AstUtils.streamAllContents(statement)].some(node => (isNameExpression(node) || isAssignmentStatement(node) || isArrayAssignmentStatement(node)) && definitions.has(node.name)
            || isUnpackStatement(node) && node.names.some(name => definitions.has(name)))) return declineCompiler('escaping-local-binding', statement);
    }
    const variants = new Map<string, Kernel | undefined>();
    let compact = new Int32Array(0), wide = new Float64Array(0);
    const inputNodes = [...inputs.values()];
    const copies = new WeakMap<RankArray, { revision: number; cells: Int32Array | BigInt64Array }>();
    return { length: end - start + 1, locals, inputs: [...inputs.keys()], builtins: [...builtins],
        target: consumer.name, consumer, run(values) {
        if (!privateLoopPolling() || inspectionEnabled()) return declineCompiler('observable-polling');
        const a: Int32Array[] = [], s: (number | boolean)[] = [], z: number[] = [], steps: number[] = [];
        const kinds = new Map<number, 'i' | 'l'>(), types = new Map<number, 'integer' | 'boolean'>();
        const bound = new Set<number>();
        const read = (id: number, at: number): number => {
            if (!Number.isSafeInteger(at) || at < 0 || at >= z[id]) rejectRegion('index-guard');
            return kinds.get(id) === 'i' ? a[id][at] : checked(a[id][at * 2 + highWord] * 4294967296 + (a[id][at * 2 + lowWord] >>> 0));
        };
        try {
            inputNodes.forEach((node, i) => {
                const value = values[i];
                if (typeof value === 'bigint') { s[node.id] = checked(Number(value)); z[node.id] = -1; }
                else {
                    if (!isRankArray(value) || value.shape.length !== 1 || value.columnNames) rejectRegion('unnamed-vector-required');
                    let cells = integer32Cells(value) ?? integer64Cells(value);
                    if (!cells) {
                        const revision = arrayRevision(value), items = denseScalarItems(value);
                        if (revision === undefined || !items || !storedScalarKinds(value)?.every(kind => kind === 'integer')
                            || items.length !== value.shape[0]) throw decline;
                        const copy = copies.get(value);
                        if (copy?.revision === revision) cells = copy.cells;
                        else {
                            let narrow = true;
                            for (let i = 0; i < items.length; i++) {
                                if ((i & 4095) === 0) checkpoint('preparing array region', Math.min(4096, items.length - i));
                                const x = items[i];
                                if (typeof x !== 'bigint' || x < -9223372036854775808n || x > 9223372036854775807n) throw decline;
                                if (x < -2147483648n || x > 2147483647n) narrow = false;
                            }
                            cells = narrow ? Int32Array.from(items as bigint[], Number) : BigInt64Array.from(items as bigint[]);
                            copies.set(value, { revision, cells });
                        }
                    }
                    kinds.set(node.id, cells instanceof Int32Array ? 'i' : 'l');
                    a[node.id] = cells instanceof Int32Array ? cells
                        : new Int32Array(cells.buffer, cells.byteOffset, cells.length * 2);
                    z[node.id] = value.shape[0];
                }
                types.set(node.id, 'integer'); bound.add(node.id);
            });
            const bind = (node: Node): void => {
                if (bound.has(node.id)) return;
                node.children.forEach(bind);
                const ids = node.children.map(child => child.id), sizes = ids.map(id => z[id]);
                let type: 'integer' | 'boolean' = 'integer';
                if (node.kind === 'literal') { s[node.id] = checked(Number(node.value)); z[node.id] = -1; }
                else if (node.kind === 'range') {
                    if (sizes.some(size => size >= 0) || ids.some(id => types.get(id) !== 'integer')) throw decline;
                    const [first, last, step] = ids.map(id => s[id] as number);
                    if (!step) rejectRegion('zero-range-step');
                    const distance = checked(step > 0 ? last - first : first - last);
                    const count = distance < (node.op === 'to' ? 0 : 1) ? 0
                        : checked((calculate('//', distance - (node.op === 'to' ? 0 : 1), Math.abs(step)) as number) + 1);
                    z[node.id] = count; s[node.id] = first; steps[node.id] = step;
                } else if (node.kind === 'select') {
                    if (sizes[0] < 0 || node.children[0].kind !== 'input' || types.get(ids[1]) !== 'integer') throw decline;
                    z[node.id] = sizes[1];
                    if (sizes[1] < 0) s[node.id] = read(ids[0], s[ids[1]] as number);
                } else if (node.kind === 'choose') {
                    if (types.get(ids[0]) !== 'boolean' || sizes[0] < 0 || ids.slice(1).some(id => types.get(id) !== 'integer')) throw decline;
                    z[node.id] = sizes.reduce(merged, -1);
                } else if (node.kind === 'binary') {
                    if (ids.some(id => types.get(id) !== 'integer')) throw decline;
                    type = ['less', 'greater', 'atmost', 'atleast', 'equal', 'notequal'].includes(node.op!) ? 'boolean' : 'integer';
                    z[node.id] = sizes.reduce(merged, -1);
                    if (z[node.id] < 0) s[node.id] = calculate(node.op!, s[ids[0]] as number, s[ids[1]] as number);
                } else throw decline;
                types.set(node.id, type); bound.add(node.id);
            };
            bind(selector); bind(rhs);
            const affine = (node: Node): { first: number; stride: number; count: number } => {
                if (node.kind === 'range') return { first: s[node.id] as number, stride: steps[node.id], count: z[node.id] };
                if (node.kind === 'binary' && ['+', '-', '*'].includes(node.op!)) {
                    const [x, y] = node.children, scalarLeft = z[x.id] < 0;
                    const value = scalarLeft ? s[x.id] : s[y.id];
                    if ((scalarLeft ? z[y.id] : z[x.id]) < 0 || typeof value !== 'number') throw decline;
                    const range = affine(scalarLeft ? y : x);
                    const first = calculate(node.op!, scalarLeft ? value : range.first, scalarLeft ? range.first : value) as number;
                    const stride = checked(range.stride * (node.op === '*' ? value : scalarLeft && node.op === '-' ? -1 : 1));
                    return { ...range, first, stride };
                }
                throw decline;
            };
            const bounds = new Map<number, [number, number]>();
            const interval = (node: Node): [number, number] => {
                const prior = bounds.get(node.id); if (prior) return prior;
                let result: [number, number] = [-Infinity, Infinity];
                if (z[node.id] < 0 && typeof s[node.id] === 'number') result = [s[node.id] as number, s[node.id] as number];
                else if (node.kind === 'range') {
                    const first = s[node.id] as number, last = first + (z[node.id] - 1) * steps[node.id];
                    result = [Math.min(first, last), Math.max(first, last)];
                } else if (node.kind === 'choose') {
                    const a = interval(node.children[1]), b = interval(node.children[2]);
                    result = [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
                } else if (node.kind === 'binary') {
                    const a = interval(node.children[0]), b = interval(node.children[1]), op = node.op!;
                    if (op === '+' || op === '-') result = op === '+' ? [a[0] + b[0], a[1] + b[1]] : [a[0] - b[1], a[1] - b[0]];
                    else if (op === 'min' || op === 'max') result = op === 'min'
                        ? [Math.min(a[0], b[0]), Math.min(a[1], b[1])] : [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
                    else if (op === '*' || op === '//') {
                        const values = a.flatMap(x => b.map(y => op === '*' ? x * y : Math.floor(x / y)));
                        result = [Math.min(...values), Math.max(...values)];
                    } else if (op === 'mod' && b[0] > 0) result = [0, b[1] - 1];
                    else if (op === 'mod' && b[1] < 0) result = [b[0] + 1, 0];
                    if (result.some(x => Number.isNaN(x) || Number.isFinite(x) && !Number.isSafeInteger(x))) result = [-Infinity, Infinity];
                }
                bounds.set(node.id, result); return result;
            };
            // Earlier named intermediates were completed before choose. Prove
            // their domains without reading an unselected gather or suppressing
            // an error the unfused assignments would have raised.
            for (const node of reachable) {
                if (node.kind === 'select') {
                    const [lo, hi] = interval(node.children[1]);
                    if (lo < 0 || hi >= z[node.children[0].id]) rejectRegion('index-guard');
                }
                if (node.kind === 'binary' && ['//', 'mod'].includes(node.op!)) {
                    const [lo, hi] = interval(node.children[1]);
                    if (lo <= 0 && hi >= 0) rejectRegion('divisor-may-be-zero');
                }
            }
            const selection = affine(selector), { first, stride, count } = selection;
            if (!count || !stride || z[target.id] < 0 || types.get(rhs.id) !== 'integer'
                || z[rhs.id] >= 0 && z[rhs.id] !== count) throw decline;
            const last = checked(first + checked((count - 1) * stride));
            if (Math.min(first, last) < 0 || Math.max(first, last) >= z[target.id]) rejectRegion('write-index-guard');
            const key = inputNodes.map(node => kinds.get(node.id) ?? 's').join('');
            if (!variants.has(key)) {
                if (variants.size >= 8) return declineCompiler('specialization-budget');
                variants.set(key, generate(kinds, z, rhs, target, consumer.operator));
            }
            const kernel = variants.get(key);
            if (!kernel) return declineCompiler('code-generation');
            const held = new Set(a.filter(Boolean).map(cells => cells.buffer));
            if (compact.length < count || held.has(compact.buffer)) compact = new Int32Array(count);
            let output: Int32Array | Float64Array = compact.subarray(0, count);
            let status = kernel(a, s, z, steps, output, first, stride, count, true);
            if (status === 1) {
                if (wide.length < count || held.has(wide.buffer)) wide = new Float64Array(count);
                output = wide.subarray(0, count);
                status = kernel(a, s, z, steps, output, first, stride, count, false);
            }
            if (status !== 0) return declineCompiler(({ 2: 'index-guard', 3: 'integer-storage-guard', 4: 'zero-divisor-guard', 5: 'arithmetic-overflow' } as Record<number, string>)[status]);
            let cells: Int32Array | BigInt64Array;
            if (output instanceof Int32Array) cells = output;
            else {
                cells = new BigInt64Array(count);
                for (let first = 0; first < count; first += 4096) {
                    const end = Math.min(count, first + 4096);
                    checkpoint('storing array region', end - first);
                    for (let i = first; i < end; i++) cells[i] = BigInt(output[i]);
                }
            }
            return { value: typedArray(cells, [count]), first: BigInt(first), step: BigInt(stride), count };
        } catch (error) { if (error !== decline) throw error; return declineCompiler('input-domain-or-layout-guard'); }
    } };
}

function generate(kinds: Map<number, 'i' | 'l'>, sizes: number[], rhs: Node, target: Node, assignment: string): Kernel | undefined {
    let serial = 0;
    const reading = (id: number, index: string, lines: string[]) => {
        const key = `k${serial++}`, value = `v${serial++}`;
        lines.push(`const ${key} = ${index}; if (!Number.isSafeInteger(${key}) || ${key} < 0 || ${key} >= z[${id}]) return 2;`);
        lines.push(`const ${value} = ${kinds.get(id) === 'i' ? `a[${id}][${key}]` : `a[${id}][${key} * 2 + ${highWord}] * 4294967296 + (a[${id}][${key} * 2 + ${lowWord}] >>> 0)`};`);
        if (kinds.get(id) === 'l') lines.push(`if (!Number.isSafeInteger(${value})) return 3;`);
        return value;
    };
    const emit = (node: Node, position: string, lines: string[], cache: Map<string, string>): string => {
        if (sizes[node.id] < 0) return `s[${node.id}]`;
        const at = `(z[${node.id}] === 1 ? 0 : ${position})`, key = `${node.id}:${position}`;
        const previous = cache.get(key); if (previous) return previous;
        let code: string;
        if (node.kind === 'input') code = reading(node.id, at, lines);
        else if (node.kind === 'range') code = `(s[${node.id}] + ${at} * steps[${node.id}])`;
        else if (node.kind === 'select') code = reading(node.children[0].id, emit(node.children[1], position, lines, cache), lines);
        else if (node.kind === 'choose') {
            const condition = emit(node.children[0], position, lines, cache), yes: string[] = [], no: string[] = [], name = `v${serial++}`;
            const a = emit(node.children[1], position, yes, new Map(cache)), b = emit(node.children[2], position, no, new Map(cache));
            lines.push(`let ${name}; if (${condition}) { ${yes.join('\n')} ${name} = ${a}; } else { ${no.join('\n')} ${name} = ${b}; }`); code = name;
        } else {
            const a = emit(node.children[0], position, lines, cache), b = emit(node.children[1], position, lines, cache);
            const op = node.op!, name = `v${serial++}`;
            let expression: string;
            if (op === 'min' || op === 'max') expression = `${b} ${op === 'min' ? '<' : '>'} ${a} ? ${b} : ${a}`;
            else if (op === '//' || op === 'mod') {
                lines.push(`if (${b} === 0) return 4;`);
                const r = `r${serial++}`; lines.push(`const ${r} = ${a} % ${b};`);
                expression = op === 'mod' ? `${r} !== 0 && (${r} < 0) !== (${b} < 0) ? ${r} + ${b} : ${r}`
                    : `(${a} - ${r}) / ${b} - (((${a} < 0) !== (${b} < 0) && ${r} !== 0) ? 1 : 0)`;
            } else expression = `${a} ${({ less: '<', greater: '>', atmost: '<=', atleast: '>=', equal: '===', notequal: '!==' } as Record<string, string>)[op] ?? op} ${b}`;
            lines.push(`const ${name} = ${expression};`); code = name;
        }
        if (node.kind === 'binary' && ['+', '-', '*'].includes(node.op!)) lines.push(`if (!Number.isSafeInteger(${code})) return 5;`);
        cache.set(key, code); return code;
    };
    const lines: string[] = [], value = emit(rhs, 'i', lines, new Map());
    let result = value;
    if (assignment !== '=') {
        const old = reading(target.id, 'first + i * stride', lines), name = `v${serial++}`;
        lines.push(`const ${name} = ${old} ${assignment.slice(0, -1)} ${value}; if (!Number.isSafeInteger(${name})) return 5;`); result = name;
    }
    const source = `return function(a,s,z,steps,out,first,stride,n,narrow) {
        for (let block=0; block<n; block+=4096) {
            const end=Math.min(n,block+4096); checkpoint('computing array region', end-block);
            for (let i=block;i<end;i++) { ${lines.join('\n')}
                if (narrow && ${result} !== (${result} | 0)) return 1; out[i]=${result};
            }
        } return 0;
    }`;
    try { return new Function('checkpoint', source)(checkpoint); } catch { return declineCompiler('dynamic-code-unavailable'); }
}
