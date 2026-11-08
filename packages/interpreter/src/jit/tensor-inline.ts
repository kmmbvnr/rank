import { scalarExtremeSource } from './operator-codegen.js';
import { tensorReductionStep } from './tensor-reduction-codegen.js';
import { findCompiledOperator, type CompiledOperator, type CompiledScalarType } from '@arrrank/language';
import type { TensorNode } from './tensor-ir.js';

export interface PreparedTensor {
    readonly value?: string;
    readonly shape?: string;
    readonly rows?: string;
    readonly columns?: string;
    readonly size?: string;
    read(index: string, lines: string[]): string;
}
export interface InlineTensorHost {
    variable(): string;
    input(node: TensorNode): PreparedTensor;
    element(node: TensorNode): CompiledScalarType;
    locate(node: TensorNode, lines: string[]): void;
    locateShape?(node: TensorNode, lines: string[]): void;
    readonly number?: boolean;
    check?(value: string, type: CompiledScalarType): string;
    readonly demandLocation?: string;
    readonly buffered?: ReadonlySet<TensorNode>;
    binary(operation: CompiledOperator, left: string, right: string, lines: string[], type: CompiledScalarType, inputs?: readonly CompiledScalarType[]): string;
}

/** Inline consumers use the same tensor IR with statically proven scalar
 * domains. Their input adapter supplies captured slots and native boundaries. */
export function inlineTensorEmitter(lines: string[], host: InlineTensorHost): (node: TensorNode) => PreparedTensor {
    const prepared = new Map<TensorNode, PreparedTensor>();
    function prepare(node: TensorNode): PreparedTensor {
        const known = prepared.get(node);
        if (known) return known;
        let source = prepareNode(node);
        let buffered = false;
        function buffer(): void {
            if (buffered || !source.size || source.value) return;
            buffered = true;
            const cache = host.variable(), reader = host.variable(), index = host.variable();
            const body: string[] = [];
            const value = source.read(index, body);
            // Populate only demanded indices; eager completion would reorder errors.
            lines.push(`const ${cache} = []; const ${reader} = (${index}) => { if (${index} in ${cache}) return ${cache}[${index}]; ${body.join('\n')} return ${cache}[${index}] = ${value}; };`);
            source = { ...source, read: index => `${reader}(${index})` };
        }
        if (host.buffered?.has(node)) buffer();
        let firstIndex: string | undefined;
        // Values may only be reused within the same generated loop body.
        const reads = new WeakMap<string[], Map<string, string>>();
        const result: PreparedTensor = { ...source, read(index, body) {
            let cells = reads.get(body);
            if (!cells) reads.set(body, cells = new Map());
            const previous = cells.get(index);
            if (previous !== undefined) return previous;
            if (firstIndex !== undefined && firstIndex !== index) buffer();
            firstIndex ??= index;
            const value = source.read(index, body);
            cells.set(index, value);
            return value;
        } };
        prepared.set(node, result);
        return result;
    }
    function prepareNode(node: TensorNode): PreparedTensor {
        if (node.kind === 'input') return host.input(node);
        if (node.kind === 'outer') {
            const { left: a, right: b } = node;
            const operation = findCompiledOperator(node.op)!;
            const left = prepare(a), right = prepare(b);
            return { size: `(${left.size} * ${right.size})`, shape: `[${left.size}, ${right.size}]`, rows: left.size, columns: right.size,
                read: (index, body) => {
                    const x = left.read(`Math.floor((${index}) / ${right.size})`, body), y = right.read(`((${index}) % ${right.size})`, body);
                    host.locate(node, body);
                    return host.binary(operation, x, y, body, host.element(node), [host.element(a), host.element(b)]);
                } };
        }
        if (node.kind === 'reduction') {
            const { operation: name, source: operand, rows } = node, input = prepare(operand);
            const read = (row: string, body: string[]) => {
                const result = host.variable(), index = host.variable();
                body.push(`let ${result} = ${host.number ? '0' : '0n'};`);
                const size = rows ? input.columns! : input.size!;
                host.locate(node, body);
                if (name === 'min' || name === 'max') body.push(`${host.demandLocation ? `location = ${host.demandLocation}; ` : ''}if (${size} === 0) throw new RankError('${name} requires at least one value', 'EmptyReduction');`);
                const loop: string[] = [];
                const value = input.read(rows ? `((${row}) * ${size} + ${index})` : index, loop);
                loop.push(tensorReductionStep(name, result, value, index, true, false, host.number));
                if (host.check) loop.push(`${result} = ${host.check(result, host.element(node))};`);
                body.push(`for (let ${index} = 0; ${index} < ${size}; ${index}++) { checkpoint('reducing function plan'); ${loop.join('\n')} }`);
                return result;
            };
            if (rows) return { size: input.rows, read };
            const result = read('0', lines);
            return { read: () => result };
        }
        if (node.kind === 'unary') {
            const operand = prepare(node.operand);
            const read = (index: string, body: string[]) => {
                const value = operand.read(index, body), result = host.variable();
                host.locate(node, body);
                const code = `${findCompiledOperator(node.op)!.unary}(${value})`;
                body.push(`const ${result} = ${host.check ? host.check(code, host.element(node)) : code};`);
                return result;
            };
            if (operand.size) return { ...operand, value: undefined, read };
            const value = read('0', lines);
            return { read: () => value };
        }
        if (node.kind !== 'binary') throw Error('unsupported inline tensor node');
        const left = prepare(node.left), right = prepare(node.right);
        let size = left.size ?? right.size;
        let shape: string | undefined, rows: string | undefined, columns: string | undefined;
        if (left.rows || right.rows) {
            shape = host.variable(); rows = host.variable(); columns = host.variable(); size = host.variable();
            const dimensions = (input: PreparedTensor) => input.shape ?? (input.size ? `[${input.size}]` : '[]');
            (host.locateShape ?? host.locate)(node, lines);
            lines.push(`const ${shape} = broadcastShape(${dimensions(left)}, ${dimensions(right)});`,
                `const ${rows} = ${shape}[0], ${columns} = ${shape}[1], ${size} = ${rows} * ${columns};`);
        } else if (left.size && right.size && left.size !== right.size) {
            size = host.variable();
            (host.locateShape ?? host.locate)(node, lines);
            lines.push(`const ${size} = broadcastShape([${left.size}], [${right.size}])[0];`);
        }
        const offset = (input: PreparedTensor, index: string) => {
            if (!input.size) return '0';
            if (columns) {
                const column = `((${index}) % ${columns})`;
                return input.rows ? `((${input.rows} === 1 ? 0 : Math.floor((${index}) / ${columns}) * ${input.columns}) + (${input.columns} === 1 ? 0 : ${column}))`
                    : `(${input.size} === 1 ? 0 : ${column})`;
            }
            return left.size && right.size && left.size !== right.size
                ? `(${input.size} === 1 ? 0 : ${index})` : index;
        };
        const read = (index: string, body: string[]) => {
            const a = left.read(offset(left, index), body);
            const b = right.read(offset(right, index), body);
            host.locate(node, body);
            if (node.native === 'min' || node.native === 'max') {
                const result = host.variable();
                body.push(`const ${result} = ${scalarExtremeSource(node.native, a, b)};`);
                return result;
            }
            return host.binary(findCompiledOperator(node.op)!, a, b, body, host.element(node), [host.element(node.left), host.element(node.right)]);
        };
        if (size) return { size, shape, rows, columns, read };
        const scalar = read('0', lines);
        return { read: () => scalar };
    }
    return prepare;
}
