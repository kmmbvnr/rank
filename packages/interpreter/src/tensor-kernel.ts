import { checkpoint, interruptsEnabled } from './interrupt.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { compilerRejection } from './compiler-rejection.js';
import {
    flattenApplication, findOperation, unaryApplicationHead, findCompiledOperator, tensorOperatorSignatures, inferCompiledExpression, matchCompiledOperatorDomains,
    isApplicationExpression, isAssignmentStatement, isReturnStatement, isBinaryExpression,
    isNameExpression, isNumberLiteral,
    isParenthesizedExpression, isUnaryExpression,
    type Expression, type Statement, type CompiledAtomType, type CompiledExpression,
} from '@arrrank/language';
import { type RankValue, isRankArray, isRankSequence } from './value.js';
import { broadcastShape } from './tensor.js';
import { arrayRevision, materializedArrayItems, ownedArray } from './array-storage.js';
import { arithmeticRange, modularRange } from './range-plan.js';
import { privateTensorNames, tensorReadCount } from './tensor-use.js';

type Terminal = 'copy' | 'sum' | 'mean' | 'any' | 'all' | 'count' | 'min' | 'max';
const bitwiseTokens = { bxor: '^', band: '&', bor: '|' } as const;
type Bitwise = keyof typeof bitwiseTokens;
const bitwise = (name: string): name is Bitwise => Object.prototype.hasOwnProperty.call(bitwiseTokens, name);
const terminals = new Set(['copy', 'sum', 'mean', 'any', 'all', 'count', 'min', 'max']);
export type TensorNode =
    | { kind: 'input'; name?: string; value?: RankValue }
    | { kind: 'binary'; op: string; native?: Bitwise; left: TensorNode; right: TensorNode }
    | { kind: 'unary'; op: string; operand: TensorNode }
    | { kind: 'select'; source: TensorNode; selector: TensorNode };
export interface TensorKernelHost {
    readonly textDigits?: boolean;
    lookup(name: string): RankValue | undefined;
    builtin(name: Terminal | 'text' | 'integer' | Bitwise): boolean;
    compiled?(source: string): void;
}
const unwrap = (value: Expression): Expression => isParenthesizedExpression(value) ? unwrap(value.value) : value;
function pair(value: Expression): Expression[] | undefined {
    const atom = unwrap(value);
    return isApplicationExpression(atom) && atom.arguments.length === 1 ? [atom.head, atom.arguments[0]] : undefined;
}
interface View { items: RankValue[]; offset: number; shape: readonly number[] }
interface Bound { shape?: readonly number[]; boolean: boolean; slot?: number; view?: View; scalar?: RankValue; filter?: boolean; digits?: boolean; progression?: { start: number; step: number; divisor?: number } }
const numeric = (value: unknown) => typeof value === 'bigint' || typeof value === 'number' && Number.isFinite(value);
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Composable tensor expression IR. Shape binding is separate from emission;
 * unsupported layouts/values decline without evaluating user code or lazy data. */
export function compileTensorKernel(statements: Statement[], host: TensorKernelHost): {
    count: number; source: string; run(): RankValue | undefined;
} | undefined {
    type Domain = readonly CompiledAtomType[];
    const domains = new Map<TensorNode, Domain>();
    const unknown: Domain = ['integer', 'real', 'boolean', 'text'];
    const definitions = new Map<string, TensorNode>();
    const reads = new Map<string, number>();
    const names: string[] = [];
    let rejected = false;
    function reject(node: Expression | Statement, detail?: string): undefined {
        if (!rejected && currentDiagnostics()) recordFallback(compilerRejection('tensor', node, detail));
        rejected = true;
        return undefined;
    }
    function typed(node: TensorNode, domain: Domain): TensorNode {
        domains.set(node, domain);
        return node;
    }
    function parse(expression: Expression): TensorNode | undefined {
        const result = inferCompiledExpression<Domain, TensorNode>(expression, {
            atom: type => type === 'integer' || type === 'real' || type === 'boolean'
                || host.textDigits && type === 'text' ? [type] : undefined,
            read: source => {
                const input = parseInput(source);
                return input ? { type: domains.get(input)!, input } : undefined;
            },
            isBound: name => definitions.has(name),
            operator: (operation, inputs) => matchCompiledOperatorDomains(operation.tensor, inputs),
            call: (operation, inputs) => bitwise(operation.name)
                && inputs.length === 2 && inputs.every(domain => domain.includes('integer'))
                ? operation.compiledCall : undefined,
            budget: { remaining: 1024 },
        });
        if (result.failure) return reject(result.failure.source, result.failure.detail);
        return lower(result.expression);
    }
    function lower(node: CompiledExpression<Domain, TensorNode>): TensorNode | undefined {
        if (node.kind === 'group') return lower(node.operand);
        if (node.kind === 'input') return node.input;
        if (node.kind === 'literal') return typed({ kind: 'input', value: node.value }, node.type);
        if (node.kind === 'call') {
            if (!bitwise(node.operation.name)) return undefined;
            const left = lower(node.arguments[0]), right = lower(node.arguments[1]);
            return left && right ? typed({ kind: 'binary', op: node.operation.name,
                native: node.operation.name, left, right }, node.type) : undefined;
        }
        if (node.kind === 'unary') {
            const operand = lower(node.operand);
            return operand ? typed({ kind: 'unary', op: node.operation.name, operand }, node.type) : undefined;
        }
        const left = lower(node.left), right = lower(node.right);
        return left && right ? typed({ kind: 'binary', op: node.operation.name, left, right }, node.type) : undefined;
    }
    function parseInput(e: Expression): TensorNode | undefined {
        if (isNameExpression(e) && !e.name.includes('.')) {
            reads.set(e.name, (reads.get(e.name) ?? 0) + 1);
            return definitions.get(e.name) ?? typed({ kind: 'input', name: e.name }, unknown);
        }
        // Rank gives power precedence over an unparenthesized sign.
        if (isBinaryExpression(e) && e.operator === '**' && !e.step && isUnaryExpression(e.left)
            && (e.left.operator === '+' || e.left.operator === '-')) {
            const left = parse(e.left.operand), right = parse(e.right);
            if (!left || !right) return undefined;
            const power = matchCompiledOperatorDomains(tensorOperatorSignatures('**', 2), [domains.get(left)!, domains.get(right)!]);
            if (!power) return undefined;
            const operand = typed({ kind: 'binary', op: '**', left, right }, power.result);
            const sign = matchCompiledOperatorDomains(tensorOperatorSignatures(e.left.operator, 1), [power.result]);
            return sign ? typed({ kind: 'unary', op: e.left.operator, operand }, sign.result) : undefined;
        }
        if (host.textDigits) {
            const parts = flattenApplication(e);
            if (parts.length === 4 && isNameExpression(parts[1]) && parts[1].name === 'integer'
                && isNameExpression(parts[2]) && parts[2].name === 'rank'
                && isNumberLiteral(parts[3]) && parts[3].value === 0n) {
                const operand = parse(parts[0]);
                return operand ? typed({ kind: 'unary', op: 'integer0', operand }, ['integer']) : undefined;
            }
            if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'text') {
                const operand = parse(parts[0]);
                return operand ? typed({ kind: 'unary', op: 'text', operand }, ['text']) : undefined;
            }
        }
        // Native calls use the shared application frontend, not selection parsing.
        const last = flattenApplication(e).at(-1);
        if (last && isNameExpression(last) && bitwise(last.name) && !definitions.has(last.name)) return undefined;
        const parts = pair(e);
        if (parts) {
            const source = parse(parts[0]), selector = parse(parts[1]);
            return source && selector ? typed({ kind: 'select', source, selector }, domains.get(source)!) : undefined;
        }
        return undefined;
    }
    // A compound arithmetic assignment is one observable rebinding. Its old
    // value remains an input, never an output buffer or a private temporary.
    const first = statements[0];
    if (isAssignmentStatement(first) && ['+=', '-=', '*='].includes(first.operator) && !first.name.includes('.')) {
        const right = parse(first.value);
        const arithmetic = (node: TensorNode): boolean => node.kind === 'input'
            || node.kind === 'unary' && ['+', '-'].includes(node.op) && arithmetic(node.operand)
            || node.kind === 'binary' && ['+', '-', '*'].includes(node.op) && arithmetic(node.left) && arithmetic(node.right);
        if (!right || !arithmetic(right)) return undefined;
        const left = typed({ kind: 'input', name: first.name }, unknown);
        const op = first.operator.slice(0, -1);
        const matched = matchCompiledOperatorDomains(tensorOperatorSignatures(op, 2), [unknown, domains.get(right)!]);
        if (!matched) return undefined;
        return build(typed({ kind: 'binary', op, left, right }, matched.result), [], 'copy', 1, host, domains);
    }
    for (let index = 0; index < Math.min(statements.length, 16); index++) {
        const statement = statements[index];
        const assignment = isAssignmentStatement(statement) && statement.operator === '=';
        if ((!assignment && !isReturnStatement(statement)) || !statement.value) return reject(statement, 'group');
        const parts = pair(statement.value);
        const last = parts && unwrap(parts[1]);
        if (last && isNameExpression(last) && terminals.has(last.name)) {
            // A dyadic overload such as `A 12 min` clips every cell; it is
            // not indexing followed by a monadic reduction. An explicit
            // `(A 12) min` or a completed unary call retains that boundary.
            if (findOperation(last.name)?.arities.includes(2)
                && flattenApplication(unwrap(statement.value)).length !== 2
                && !unaryApplicationHead(unwrap(statement.value), name => findOperation(name)?.arities)) {
                return reject(statement, 'dyadic-terminal');
            }
            const root = parse(parts![0]);
            if (!root || root.kind === 'input' && names.length === 0) return reject(statement, 'group');
            if (!privateTensorNames(statements[0], names)
                || names.some(name => tensorReadCount(statements[0], name) !== reads.get(name))) return reject(statement, 'group');
            // Do not discard independent assignments merely because a later
            // expression ends with a reduction.
            const reached = new Set<TensorNode>();
            const visit = (node: TensorNode): void => {
                if (reached.has(node)) return;
                reached.add(node);
                if (node.kind === 'binary') { visit(node.left); visit(node.right); }
                if (node.kind === 'unary') visit(node.operand);
                if (node.kind === 'select') { visit(node.source); visit(node.selector); }
            };
            visit(root);
            if ([...definitions.values()].some(node => !reached.has(node))) return reject(statement, 'group');
            return build(root, names, last.name as Terminal, index + 1, host, domains);
        }
        if (!isAssignmentStatement(statement)) return reject(statement, 'group');
        const value = parse(statement.value);
        if (!value || definitions.has(statement.name)) return reject(statement, 'group');
        definitions.set(statement.name, value);
        names.push(statement.name);
    }
    return recordFallback('tensor:no-terminal');
}

function build(root: TensorNode, names: string[], terminal: Terminal, count: number, host: TensorKernelHost,
    domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>) {
    const nativeCalls = [...new Set([...domains.keys()].flatMap(node =>
        node.kind === 'binary' && node.native ? [node.native] : []))];
    const sequenceSelectors = new Set([...domains.keys()].flatMap(node =>
        node.kind === 'select' && node.selector.kind === 'input' ? [node.selector] : []));
    let cachedKey: string | undefined;
    type KernelRun = (data: RankValue[][], offsets: number[], scalars: RankValue[], size: number) => RankValue | RankValue[] | undefined;
    let cachedRun: KernelRun | undefined;
    // Cache layout only: never retain operand storage or a previous result.
    // Selections and text conversions keep the general binder below.
    type InputLayout = { name?: string; value?: RankValue; slot: number; shape?: readonly number[]; boolean: boolean };
    let layout: { inputs: InputLayout[]; offsets: number[]; shape: readonly number[]; size: number;
        interruptible: boolean; execute: KernelRun } | undefined;
    let generated = '';
    let unavailable = false;
    return { count, get source() { return generated; }, run(): RankValue | undefined {
        for (const name of nativeCalls) if (!host.builtin(name)) return recordFallback(`tensor:builtin:${name}`);
        if (unavailable) return recordFallback('tensor:code-generation');
        if (names.some(name => host.lookup(name) !== undefined)) return recordFallback('tensor:existing-binding');
        // Interrupt callbacks may enter this kernel again with another shape.
        const plan = layout;
        if (plan && plan.interruptible === interruptsEnabled() && host.builtin(terminal)) {
            const data: RankValue[][] = [], scalars: RankValue[] = [];
            let matches = true;
            for (const input of plan.inputs) {
                const value = input.name === undefined ? input.value : host.lookup(input.name);
                if (input.shape) {
                    if (!value || !isRankArray(value) || arrayRevision(value) === undefined
                        || !same(value.shape, input.shape)) { matches = false; break; }
                    const items = materializedArrayItems(value);
                    if (!Array.isArray(items) || items.length !== input.shape.reduce((a, b) => a * b, 1)
                        || (typeof items[0] === 'boolean') !== input.boolean) { matches = false; break; }
                    data[input.slot] = items;
                } else {
                    if (!(numeric(value) || typeof value === 'boolean')
                        || (typeof value === 'boolean') !== input.boolean) { matches = false; break; }
                    scalars[input.slot] = value!;
                }
            }
            if (matches) {
                const result = plan.execute(data, plan.offsets, scalars, plan.size);
                return terminal === 'copy' && result !== undefined
                    ? ownedArray(result as RankValue[], plan.shape, true) : result as RankValue | undefined;
            }
        }
        return bindRun();
    } };

    function bindRun(): RankValue | undefined {
        layout = undefined;
        const bound = new Map<TensorNode, Bound>();
        let broadcasts = false;
        const data: RankValue[][] = [], offsets: number[] = [], scalars: RankValue[] = [];
        let bindingRejected = false;
        function rejectBinding(reason: string): undefined {
            if (!bindingRejected) recordFallback(reason);
            bindingRejected = true;
            return undefined;
        }
        function bind(node: TensorNode): Bound | undefined {
            const result = bindNode(node);
            if (!result && !bindingRejected) rejectBinding(`tensor:binding:${node.kind === 'binary' || node.kind === 'unary' ? node.op : node.kind === 'input' ? node.name ?? 'literal' : node.kind}`);
            return result;
        }
        function bindNode(node: TensorNode): Bound | undefined {
            if (bound.has(node)) return bound.get(node);
            let result: Bound | undefined;
            if (node.kind === 'input') {
                const value = node.name === undefined ? node.value : host.lookup(node.name);
                if (numeric(value) || typeof value === 'boolean' || host.textDigits && typeof value === 'string') {
                    result = { scalar: value, boolean: typeof value === 'boolean', slot: scalars.push(value!) - 1 };
                } else if (value && isRankSequence(value)) {
                    if (!sequenceSelectors.has(node)) return undefined;
                    const modular = modularRange(value.plan);
                    const range = modular ?? arithmeticRange(value.plan);
                    if (!range || range.count < 0n || range.count > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
                    result = { shape: [Number(range.count)], boolean: false, progression: {
                        start: scalars.push(range.start) - 1, step: scalars.push(range.step) - 1,
                        divisor: modular ? scalars.push(modular.divisor) - 1 : undefined,
                    } };
                } else if (value && isRankArray(value)) {
                    // Host-owned arrays can run getters while probing their
                    // cells. Only tracked storage is safe to inspect here.
                    if (arrayRevision(value) === undefined) return rejectBinding('tensor:untracked-storage');
                    const items = materializedArrayItems(value);
                    if (!Array.isArray(items) || !value.shape.every(n => Number.isSafeInteger(n) && n >= 0)
                        || value.shape.reduce((p, n) => p * n, 1) !== items.length) return undefined;
                    const view = { items, offset: 0, shape: value.shape };
                    result = { shape: view.shape, view, boolean: typeof items[0] === 'boolean' };
                }
            } else if (node.kind === 'binary') {
                const a = bind(node.left), b = bind(node.right);
                // Sequence arithmetic zips streams; it does not broadcast like
                // arrays. Proved progressions are used only as gather selectors.
                if (!a || !b || a.progression || b.progression) return undefined;
                let shape = a.shape ?? b.shape;
                if (a.shape && b.shape && !same(a.shape, b.shape)) {
                    try { shape = broadcastShape(a.shape, b.shape); }
                    catch { return undefined; }
                    broadcasts = true;
                }
                result = { shape, boolean: domains.get(node)!.every(type => type === 'boolean') };
            } else if (node.kind === 'unary') {
                const a = bind(node.operand);
                if (a?.progression) return undefined;
                if (node.op === 'text') {
                    if (a && typeof a.scalar === 'bigint' && host.builtin('text')) {
                        const value = a.scalar.toString();
                        result = { scalar: value, boolean: false, slot: scalars.push(value) - 1 };
                    }
                } else if (node.op === 'integer0') {
                    if (a && typeof a.scalar === 'string' && !/[^0-9]/.test(a.scalar) && host.builtin('integer')) {
                        result = { shape: [a.scalar.length], boolean: false, digits: true, slot: scalars.push(a.scalar) - 1 };
                    }
                } else if (a) result = { shape: a.shape, boolean: domains.get(node)!.every(type => type === 'boolean') };
            } else {
                const a = bind(node.source), b = bind(node.selector);
                if (!a || !b || a.progression || !a.shape || a.shape.length === 0) return undefined;
                if (typeof b.scalar === 'bigint' && a.view && b.scalar >= 0n && b.scalar < BigInt(a.shape[0])) {
                    const shape = a.shape.slice(1);
                    const stride = shape.reduce((p, n) => p * n, 1);
                    const view = { ...a.view, shape, offset: a.view.offset + Number(b.scalar) * stride };
                    if (shape.length === 0) {
                        const scalar = view.items[view.offset];
                        if (!numeric(scalar) && typeof scalar !== 'boolean') return undefined;
                        result = { scalar, boolean: typeof scalar === 'boolean', slot: scalars.push(scalar) - 1 };
                    } else result = { shape, view, boolean: typeof view.items[view.offset] === 'boolean' };
                } else if (b.shape && b.boolean && a.shape.length === 1 && same(a.shape, b.shape)) {
                    result = { shape: a.shape, boolean: a.boolean, filter: true };
                } else if (b.shape?.length === 1 && !b.boolean && a.view && a.shape.length === 1) {
                    result = { shape: b.shape, boolean: a.boolean };
                }
            }
            // Fold only total numeric arithmetic, before entering the array
            // domain. Other scalar operations retain the reference timing path.
            if (result && result.shape === undefined && result.scalar === undefined) {
                let scalar: RankValue | undefined;
                if (node.kind === 'binary' && ['+', '-', '*'].includes(node.op)) {
                    const a = bound.get(node.left)?.scalar, b = bound.get(node.right)?.scalar;
                    if (numeric(a) && numeric(b)) {
                        if (typeof a === 'bigint' && typeof b === 'bigint') scalar = node.op === '+' ? a+b : node.op === '-' ? a-b : a*b;
                        else scalar = node.op === '+' ? Number(a)+Number(b) : node.op === '-' ? Number(a)-Number(b) : Number(a)*Number(b);
                    }
                } else if (node.kind === 'unary' && ['+', '-'].includes(node.op)) {
                    const a = bound.get(node.operand)?.scalar;
                    if (numeric(a)) scalar = node.op === '+' ? a : typeof a === 'bigint' ? -a : -Number(a);
                }
                if (scalar !== undefined && numeric(scalar)) result = { scalar, boolean: false, slot: scalars.push(scalar)-1 };
            }
            // Scalar computations are evaluated before their surrounding
            // tensor operation, even for an empty/fully filtered domain. Until
            // scalar lowering preserves that timing, leave them to reference.
            if (result && result.shape === undefined && result.scalar === undefined) return rejectBinding('tensor:scalar-evaluation-timing');
            if (result) {
                if (result.view) {
                    result.slot = data.push(result.view.items) - 1;
                    offsets.push(result.view.offset);
                }
                bound.set(node, result);
            }
            return result;
        }
        const output = bind(root);
        if (!output) return undefined;
        if (!output.shape) return recordFallback('tensor:output-shape');
        if (!host.builtin(terminal)) return recordFallback(`tensor:builtin:${terminal}`);
        // A gather preserves its selector's frame: broadcast its selector,
        // then use that value to address the source, never broadcast the table.
        // Filters change cardinality and still require a separate domain plan.
        if (broadcasts && [...bound.values()].some(info => info.filter || info.digits)) {
            return recordFallback('tensor:broadcast-selection');
        }
        const size = output.shape.reduce((p, n) => p * n, 1);
        // A selection changes cardinality. Other operands must not zip an
        // unfiltered vector against it. Until domain algebra is implemented,
        // only scalar maps and gathers can follow a filter.
        const filtered = new Map<TensorNode, boolean>();
        function domain(node: TensorNode): boolean {
            if (filtered.has(node)) return filtered.get(node)!;
            let value = bound.get(node)?.filter ?? false;
            if (node.kind === 'unary') value ||= domain(node.operand);
            if (node.kind === 'select') value ||= domain(node.selector);
            if (node.kind === 'binary') {
                const a = domain(node.left), b = domain(node.right);
                if (a && bound.get(node.right)?.shape || b && bound.get(node.left)?.shape) throw false;
                value ||= a || b;
            }
            filtered.set(node, value);
            return value;
        }
        try { domain(root); } catch { return recordFallback('tensor:filtered-domain'); }
        // Array output initially requires a fixed cardinality.
        if (terminal === 'copy' && [...filtered.values()].some(Boolean)) return recordFallback('tensor:filtered-copy');
        const interruptible = interruptsEnabled();
        const key = String(interruptible) + [...bound.values()].map(b => `${b.shape === undefined ? 's' : b.shape.join(',')}:${b.view ? 'v' : ''}:${b.boolean}:${b.filter ?? false}:${b.slot ?? ''}:${b.progression ? `${b.progression.start},${b.progression.step},${b.progression.divisor ?? ''}` : ''}`).join(';');
        let execute = cachedRun;
        if (cachedKey !== key) {
            const lines: string[] = [];
            const emitted = new Map<TensorNode, string>();
            const num = (x: string) => `(typeof ${x} === 'bigint' || typeof ${x} === 'number' && Number.isFinite(${x}))`;
            function address(shape: readonly number[]): string {
                if (same(shape, output!.shape!)) return 'i';
                const target = output!.shape!;
                let sourceStride = 1, targetStride = 1;
                const terms: string[] = [];
                for (let axis = target.length - 1; axis >= 0; axis--) {
                    const sourceAxis = axis - (target.length - shape.length);
                    if (sourceAxis >= 0) {
                        const dimension = shape[sourceAxis];
                        if (dimension !== 1) {
                            const coordinate = targetStride === 1 ? 'i' : `Math.floor(i / ${targetStride})`;
                            terms.push(`(${coordinate} % ${target[axis]}) * ${sourceStride}`);
                        }
                        sourceStride *= dimension;
                    }
                    targetStride *= target[axis];
                }
                return terms.join(' + ') || '0';
            }
            function emit(node: TensorNode): string {
                const existing = emitted.get(node);
                if (existing) return existing;
                const info = bound.get(node)!;
                const name = `v${emitted.size}`;
                emitted.set(node, name);
                if (info.scalar !== undefined) lines.push(`const ${name} = scalars[${info.slot}];`);
                else if (info.progression) {
                    const { start, step, divisor } = info.progression;
                    const index = broadcasts ? address(info.shape!) : 'i';
                    lines.push(`const ${name}raw = scalars[${start}] + BigInt(${index}) * scalars[${step}];`);
                    if (divisor === undefined) lines.push(`const ${name} = ${name}raw;`);
                    else {
                        lines.push(`const ${name}rem = ${name}raw % scalars[${divisor}];`);
                        lines.push(`const ${name} = ${name}rem !== 0n && (${name}rem < 0n) !== (scalars[${divisor}] < 0n) ? ${name}rem + scalars[${divisor}] : ${name}rem;`);
                    }
                }
                else if (info.digits) lines.push(`const ${name} = BigInt(scalars[${info.slot}].charCodeAt(i) - 48);`);
                else if (info.view) lines.push(`const ${name} = data[${info.slot}][offsets[${info.slot}] + ${broadcasts ? address(info.view.shape) : 'i'}];`);
                else if (node.kind === 'binary') {
                    const a = emit(node.left), b = emit(node.right);
                    const decline = `return decline(${JSON.stringify(`tensor:operator-guard:${node.op}`)});`;
                    if (node.native) {
                        lines.push(`if (typeof ${a} !== 'bigint' || typeof ${b} !== 'bigint') ${decline}`);
                        lines.push(`const ${name} = ${a} ${bitwiseTokens[node.native]} ${b};`);
                        return name;
                    }
                    const signatures = tensorOperatorSignatures(node.op, 2);
                    const token = findCompiledOperator(node.op)!.binary;
                    if (signatures.every(signature => signature.inputs[0] === 'boolean')) {
                        lines.push(`if (typeof ${a} !== 'boolean' || typeof ${b} !== 'boolean') ${decline}`);
                        lines.push(`const ${name} = ${a} ${token} ${b};`);
                    } else {
                        lines.push(`if (!${num(a)} || !${num(b)}) ${decline}`);
                        if (signatures.every(signature => signature.result === 'boolean')) {
                            lines.push(`if (typeof ${a} !== typeof ${b}) ${decline}`);
                            lines.push(`const ${name} = ${a} ${token} ${b};`);
                        } else {
                            if (node.op === '/') lines.push(`if (${b} === 0n || ${b} === 0) ${decline}`);
                            if (node.op === '**') lines.push(`if (${b} < 0 || ${b} > 1024 || (typeof ${b} === 'number' && !Number.isInteger(${b}))) ${decline}`);
                            const expr = `Number(${a}) ${token} Number(${b})`;
                            lines.push(`const ${name} = ${node.op === '/' ? expr : `(typeof ${a} === 'bigint' && typeof ${b} === 'bigint' ? ${a} ${token} ${b} : ${expr})`};`);
                        }
                    }
                } else if (node.kind === 'unary') {
                    const a = emit(node.operand);
                    const decline = `return decline(${JSON.stringify(`tensor:operator-guard:${node.op}`)});`;
                    const boolean = tensorOperatorSignatures(node.op, 1).every(signature => signature.inputs[0] === 'boolean');
                    lines.push(`if (${boolean ? `typeof ${a} !== 'boolean'` : `!${num(a)}`}) ${decline}`);
                    lines.push(`const ${name} = ${findCompiledOperator(node.op)!.unary}${a};`);
                } else if (node.kind === 'select') {
                    const b = emit(node.selector);
                    const decline = `return decline('tensor:selection-guard');`;
                    if (info.filter) {
                        lines.push(`if (typeof ${b} !== 'boolean') ${decline} if (!${b}) continue;`);
                        const a = emit(node.source);
                        lines.push(`const ${name} = ${a};`);
                    } else {
                        const source = bound.get(node.source)!;
                        lines.push(`if (typeof ${b} !== 'bigint' || ${b} < 0n || ${b} >= BigInt(${source.shape![0]})) ${decline}`);
                        lines.push(`const ${name} = data[${source.slot}][offsets[${source.slot}] + Number(${b})];`);
                    }
                }
                return name;
            }
            const value = emit(root);
            const isBoolean = terminal === 'copy' ? output.boolean : ['any', 'all', 'count'].includes(terminal);
            lines.push(`if (${isBoolean ? `typeof ${value} !== 'boolean'` : `!${num(value)}`}) return decline('tensor:terminal-type:${terminal}');`);
            if (terminal === 'copy') lines.push(`answer[i] = ${value};`);
            if (terminal === 'sum') lines.push(`answer = typeof answer === 'bigint' && typeof ${value} === 'bigint' ? answer + ${value} : Number(answer) + Number(${value});`);
            if (terminal === 'mean') lines.push(`answer += Number(${value});`);
            if (terminal === 'count') lines.push(`if (${value}) answer += 1n;`);
            if (terminal === 'any' || terminal === 'all') lines.push(`answer = answer ${terminal === 'any' ? '||' : '&&'} ${value};`);
            if (terminal === 'min' || terminal === 'max') lines.push(`if (length === 0 || ${value} ${terminal === 'min' ? '<' : '>'} answer) answer = ${value};`);
            lines.push('length++;');
            const initial = terminal === 'copy' ? 'new Array(size)' : terminal === 'mean' ? '0' : terminal === 'all' ? 'true' : terminal === 'any' ? 'false' : '0n';
            generated = `"use strict"; return function(data, offsets, scalars, size) { let answer = ${initial}, length = 0; for (let i = 0; i < size; i++) { ${interruptible ? "checkpoint('computing tensor');" : ''}\n${lines.join('\n')}\n} ${['mean', 'min', 'max'].includes(terminal) ? `if (length === 0) return decline('tensor:empty-terminal:${terminal}');` : ''} return ${terminal === 'mean' ? 'answer / length' : 'answer'}; };`;
            try { execute = new Function('checkpoint', 'decline', generated)(checkpoint, recordFallback) as KernelRun; }
            catch { unavailable = true; return recordFallback('tensor:code-generation'); }
            cachedKey = key;
            cachedRun = execute;
            host.compiled?.(generated);
        }
        if ([...bound.keys()].every(node => node.kind !== 'select'
            && !(node.kind === 'unary' && (node.op === 'text' || node.op === 'integer0')))
            && [...bound].every(([node, info]) => node.kind === 'input' || info.scalar === undefined)
            && [...bound.values()].every(info => !info.progression && (info.scalar === undefined || numeric(info.scalar) || typeof info.scalar === 'boolean'))) {
            layout = { inputs: [...bound].flatMap(([node, info]) => node.kind === 'input' ? [{
                name: node.name, value: node.value,
                slot: info.slot!, shape: info.shape && [...info.shape], boolean: info.boolean,
            }] : []), offsets: [...offsets], shape: [...output.shape], size, interruptible, execute: execute! };
        }
        const result = execute!(data, offsets, scalars, size);
        if (terminal === 'copy' && result !== undefined) {
            return ownedArray(result as RankValue[], output.shape, true);
        }
        return result as RankValue | undefined;
    }
}
