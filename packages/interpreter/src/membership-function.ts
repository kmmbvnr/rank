import {
    flattenApplication, isApplicationExpression, isAssignmentStatement, isBinaryExpression,
    isNameExpression, isNumberLiteral, isParenthesizedExpression, isReturnStatement, isUnaryExpression,
    type Expression, type FunctionStatement,
} from '@arrrank/language';
import { ownedArray } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { prepareIntegerView } from './integer-view.js';
import { isNativeFunction, type RankValue } from './value.js';
import { membershipKeys } from './membership-keys.js';

type Node = { kind: 'read'; name: string } | { kind: 'literal'; value: bigint }
    | { kind: 'concat'; parts: Node[] }
    | { kind: 'binary'; op: string; left: Node; right: Node };
type Bound = { scalar: bigint } | { length: number; read(index: number): bigint };
export interface RankedMembership {
    readonly width: number;
    fill(frame: number, items: boolean[]): void;
}

/** Compile straight-line integer vector arithmetic consumed by membership.
 * Local intermediates stay private: concat writes keys directly into the lookup.
 * Unsupported bodies/values decline before evaluating any array cell. */
export function compileMembershipFunction(statement: FunctionStatement): {
    locals: readonly string[];
    captures: readonly string[];
    prepare(args: readonly RankValue[], lookup: (name: string) => RankValue | undefined): (() => RankValue) | undefined;
    prepareRanked(source: RankValue, axes: readonly number[], lookup: (name: string) => RankValue | undefined): RankedMembership | undefined;
} | undefined {
    if (statement.memo || statement.parameters.length === 0) return undefined;
    const definitions = new Map<string, Node>();
    const locals: string[] = [];
    const assignments: Node[] = [];
    const names = new Set<string>();
    let concatenated = false;
    const parse = (expression: Expression): Node | undefined => {
        if (isParenthesizedExpression(expression)) return parse(expression.value);
        if (isNumberLiteral(expression) && typeof expression.value === 'bigint') return { kind: 'literal', value: expression.value };
        if (isUnaryExpression(expression) && expression.operator === '-') {
            const right = parse(expression.operand);
            return right && { kind: 'binary', op: '-', left: { kind: 'literal', value: 0n }, right };
        }
        if (isNameExpression(expression) && !expression.name.includes('.')) {
            const local = definitions.get(expression.name);
            if (local) return local;
            names.add(expression.name);
            return { kind: 'read', name: expression.name };
        }
        if (isBinaryExpression(expression) && ['+', '-', '*'].includes(expression.operator) && !expression.step) {
            const left = parse(expression.left), right = parse(expression.right);
            return left && right && { kind: 'binary', op: expression.operator, left, right };
        }
        if (isApplicationExpression(expression)) {
            const [head, ...parts] = flattenApplication(expression);
            if (!isNameExpression(head) || head.name !== 'concat' || parts.length === 0) return undefined;
            const inputs = parts.map(parse);
            if (inputs.some(part => part === undefined)) return undefined;
            concatenated = true;
            return { kind: 'concat', parts: inputs as Node[] };
        }
        return undefined;
    };
    const commands = statement.statements;
    const last = commands.at(-1);
    if (!last || !isReturnStatement(last) || !last.value || !isBinaryExpression(last.value)
        || !['in', 'notin'].includes(last.value.operator)) return undefined;
    for (const command of commands.slice(0, -1)) {
        if (!isAssignmentStatement(command) || command.operator !== '=' || !command.value
            || command.name.includes('.') || definitions.has(command.name)
            || statement.parameters.includes(command.name) || names.has(command.name)) return undefined;
        const node = parse(command.value);
        if (!node || names.has(command.name)) return undefined;
        definitions.set(command.name, node);
        assignments.push(node);
        locals.push(command.name);
    }
    const left = parse(last.value.left), right = parse(last.value.right);
    if (!left || !right || !concatenated) return undefined;
    const invert = last.value.operator === 'notin';
    const valueOf = (value: RankValue | undefined): Bound | undefined => {
        if (typeof value === 'bigint') return { scalar: value };
        if (value === undefined) return undefined;
        const view = prepareIntegerView(value);
        return view?.shape.length === 1 ? { length: view.shape[0], read: view.read } : undefined;
    };
    const build = (values: ReadonlyMap<string, Bound>): { width: number; fill(items: boolean[]): void } | undefined => {
        const bound = new Map<Node, Bound>();
        const bind = (node: Node): Bound | undefined => {
            const previous = bound.get(node);
            if (previous) return previous;
            let result: Bound;
            if (node.kind === 'read') result = values.get(node.name)!;
            else if (node.kind === 'literal') result = { scalar: node.value };
            else if (node.kind === 'concat') {
                const parts = node.parts.map(bind);
                if (parts.some(part => !part || 'scalar' in part)) return undefined;
                const vectors = parts as { length: number; read(index: number): bigint }[];
                result = { length: vectors.reduce((sum, part) => sum + part.length, 0), read(index) {
                    for (const part of vectors) { if (index < part.length) return part.read(index); index -= part.length; }
                    throw new Error('invalid compiled concat index');
                } };
            } else {
                const a = bind(node.left), b = bind(node.right);
                if (!a || !b || (!('scalar' in a) && !('scalar' in b) && a.length !== b.length)) return undefined;
                const op = node.op === '+' ? (a: bigint, b: bigint) => a + b
                    : node.op === '-' ? (a: bigint, b: bigint) => a - b : (a: bigint, b: bigint) => a * b;
                result = 'scalar' in a && 'scalar' in b ? { scalar: op(a.scalar, b.scalar) }
                    : { length: 'scalar' in a ? (b as Exclude<Bound, { scalar: bigint }>).length : a.length,
                        read: index => op('scalar' in a ? a.scalar : a.read(index), 'scalar' in b ? b.scalar : b.read(index)) };
            }
            bound.set(node, result);
            return result;
        };
        for (const node of assignments) if (!bind(node)) return undefined;
        const query = bind(left), candidates = bind(right);
        if (!query || !candidates || 'scalar' in query || 'scalar' in candidates) return undefined;
        // Only after every guard succeeded may we read the proven storage.
        const keys = membershipKeys<bigint>(candidates.length);
        const add = (node: Node): void => {
            if (node.kind === 'concat') { node.parts.forEach(add); return; }
            const value = bound.get(node)!;
            if ('scalar' in value) throw new Error('invalid compiled membership input');
            for (let i = 0; i < value.length; i++) { checkpoint('indexing membership'); keys.add(value.read(i)); }
        };
        return { width: query.length, fill(items) {
            keys.clear();
            add(right);
            for (let i = 0; i < items.length; i++) { checkpoint('testing membership'); items[i] = keys.has(query.read(i)) !== invert; }
        } };
    };
    const captures = [...names].filter(name => !statement.parameters.includes(name));
    return { locals, captures, prepare(args, lookup) {
        if (args.length !== statement.parameters.length || args.some(isNativeFunction)) return undefined;
        const values = new Map<string, Bound>();
        for (const name of names) {
            const parameter = statement.parameters.indexOf(name);
            const value = valueOf(parameter < 0 ? lookup(name) : args[parameter]);
            if (!value) return undefined;
            values.set(name, value);
        }
        const kernel = build(values);
        return kernel && (() => {
            const items = new Array<boolean>(kernel.width);
            kernel.fill(items);
            return ownedArray(items, [items.length], true);
        });
    }, prepareRanked(source, axes, lookup) {
        if (statement.parameters.length !== 1) return undefined;
        const view = prepareIntegerView(source);
        if (!view || axes.length !== view.shape.length - 1) return undefined;
        const cellAxis = view.shape.findIndex((_, axis) => !axes.includes(axis));
        if (cellAxis < 0) return undefined;
        const strides = view.shape.map(() => 1);
        for (let i = strides.length - 2; i >= 0; i--) strides[i] = strides[i + 1] * view.shape[i + 1];
        let base = 0;
        const values = new Map<string, Bound>([[statement.parameters[0], {
            length: view.shape[cellAxis], read: i => view.read(base + i * strides[cellAxis]),
        }]]);
        for (const name of captures) {
            const value = valueOf(lookup(name));
            if (!value) return undefined;
            values.set(name, value);
        }
        const kernel = build(values);
        return kernel && { width: kernel.width, fill(frame, items) {
            base = 0;
            for (let i = axes.length - 1; i >= 0; i--) {
                const axis = axes[i];
                base += (frame % view.shape[axis]) * strides[axis];
                frame = Math.floor(frame / view.shape[axis]);
            }
            kernel.fill(items);
        } };
    } };
}
