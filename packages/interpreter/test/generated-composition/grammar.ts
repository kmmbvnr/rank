/** Bounded typed grammar. Every constructor fixes its result domain; shrinking
 * replaces nodes only with the same domain. No source-text deletion or eval. */
export type Scalar =
    | { type: 'integer'; kind: 'literal'; value: number }
    | { type: 'integer'; kind: 'input' }
    | { type: 'integer'; kind: 'binary'; op: '+' | '-' | '*'; left: Scalar; right: Scalar }
    | { type: 'integer'; kind: 'reduce'; value: Vector }
    | { type: 'integer'; kind: 'field'; value: RecordExpr }
    | { type: 'integer'; kind: 'fold'; value: QueueExpr }
    | { type: 'integer'; kind: 'lazy' | 'effect' | 'protected' | 'generator' | 'helper' | 'higher' | 'capture' | 'local'; value: Scalar }
    | { type: 'integer'; kind: 'branch'; left: Scalar; right: Scalar; threshold: number }
    | { type: 'integer'; kind: 'loop'; value: Scalar; count: number; control: 'none' | 'break' | 'continue' };
export type Vector =
    | { type: 'array'; kind: 'fill'; rank: number; size: number; value: Scalar }
    | { type: 'array'; kind: 'map'; rank: number; value: Vector; body: Scalar }
    | { type: 'array'; kind: 'snapshot'; rank: 1; value: Scalar; delta: number };
export type RecordExpr = { type: 'record'; kind: 'record'; value: Scalar; delta: number };
export type QueueExpr = { type: 'queue'; kind: 'queue'; values: Scalar[] };
export type Expr = Scalar | Vector | RecordExpr | QueueExpr;
export interface Program { seed: number; input: number; expression: Expr }
const literal = (value = 0): Scalar => ({ type: 'integer', kind: 'literal', value });

export function generate(seed: number, depth = 3): Program {
    let state = seed >>> 0;
    const pick = (size: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % size; };
    function scalar(remaining: number, loop = false): Scalar {
        if (remaining <= 0) return pick(16) === 0 ? literal(Number.MAX_SAFE_INTEGER)
            : pick(3) ? literal(pick(9) - 4) : { type: 'integer', kind: 'input' };
        const next = () => scalar(remaining - 1, loop);
        switch (pick(loop ? 16 : 17)) {
            case 0: case 1: case 2: return { type: 'integer', kind: 'binary', op: (['+', '-', '*'] as const)[pick(3)], left: next(), right: next() };
            case 3: return { type: 'integer', kind: 'reduce', value: vector(remaining - 1, loop) };
            case 4: return { type: 'integer', kind: 'field', value: record(remaining - 1, loop) };
            case 5: return { type: 'integer', kind: 'fold', value: queue(remaining - 1, loop) };
            case 6: return { type: 'integer', kind: 'lazy', value: next() };
            case 7: return { type: 'integer', kind: 'effect', value: next() };
            case 8: return { type: 'integer', kind: 'protected', value: next() };
            case 9: return { type: 'integer', kind: 'generator', value: next() };
            case 10: return { type: 'integer', kind: 'helper', value: next() };
            case 11: return { type: 'integer', kind: 'higher', value: next() };
            case 12: return { type: 'integer', kind: 'branch', left: next(), right: next(), threshold: pick(5) };
            case 13: return { type: 'integer', kind: 'local', value: next() };
            case 14: return literal(pick(17) - 8);
            case 15: return { type: 'integer', kind: 'capture', value: next() };
            default: return { type: 'integer', kind: 'loop', value: scalar(remaining - 1, true), count: pick(4) + 1,
                control: (['none', 'break', 'continue'] as const)[pick(3)] };
        }
    }
    function vector(remaining: number, loop: boolean): Vector {
        const rank = pick(3) + 1;
        if (remaining > 0 && pick(3) === 0) {
            const value = vector(remaining - 1, loop);
            return { type: 'array', kind: 'map', rank: value.rank, value, body: scalar(remaining - 1, loop) };
        }
        if (remaining > 0 && pick(3) === 0) return { type: 'array', kind: 'snapshot', rank: 1,
            value: scalar(remaining - 1, loop), delta: pick(5) + 1 };
        return { type: 'array', kind: 'fill', rank, size: pick(3), value: scalar(Math.max(0, remaining - 1), loop) };
    }
    function record(remaining: number, loop: boolean): RecordExpr {
        return { type: 'record', kind: 'record', value: scalar(Math.max(0, remaining - 1), loop), delta: pick(5) };
    }
    function queue(remaining: number, loop: boolean): QueueExpr {
        return { type: 'queue', kind: 'queue', values: Array.from({ length: pick(3) + 1 }, () => scalar(Math.max(0, remaining - 1), loop)) };
    }
    const input = pick(9) - 4;
    const type = pick(4);
    const expression = type === 0 ? vector(depth, false) : type === 1 ? record(depth, false)
        : type === 2 ? queue(depth, false) : scalar(depth);
    return { seed, input, expression };
}

export type Transformation = 'none' | 'helper' | 'local';
export function print(program: Program, transformation: Transformation = 'none'): string {
    let serial = 0, transformed = false;
    const definitions: string[] = [];
    const name = (prefix: string) => `${prefix}${serial++}`;
    function emit(node: Expr, input: string, lines: string[], transform = true): string {
        // A literal/input is a pure scalar subtree. Moving its read into a local
        // helper with an explicit argument preserves demand and evaluation order.
        if (transform && !transformed && transformation !== 'none' && node.type === 'integer'
            && (node.kind === 'binary' && pure(node) || node.kind === 'input' || node.kind === 'literal')) {
            transformed = true;
            return emit({ type: 'integer', kind: transformation, value: node }, input, lines, false);
        }
        const value = name('Value');
        const child = (item: Expr) => emit(item, input, lines, transform);
        switch (node.kind) {
            case 'literal': return node.value < 0 ? `(${node.value})` : String(node.value);
            case 'input': return input;
            case 'binary': return `(${child(node.left)} ${node.op} ${child(node.right)})`;
            case 'fill': {
                const item = child(node.value);
                lines.push(`${value} = array shape ${Array(node.rank).fill(node.size).join(' ')} fill ${item}`);
                return value;
            }
            case 'reduce': return `(${child(node.value)} sum rank ${node.value.rank})`;
            case 'record': {
                const item = child(node.value);
                lines.push(`${value} = record`, ` .count = ${item}`, ` .positive = ${input} greater 0`, ' .label = "entry"', 'end', `${value} .count += ${node.delta}`);
                return value;
            }
            case 'field': return `(${child(node.value)} .count)`;
            case 'queue': {
                lines.push(`${value} = new queue`);
                for (const item of node.values) lines.push(`${value} push ${child(item)}`);
                return value;
            }
            case 'fold': return `(${child(node.value)} sum)`;
            case 'snapshot': {
                const item = child(node.value), alias = name('Saved'), result = name('Result');
                lines.push(`${value} = array ${item} ${item}`, `${alias} = ${value}`, `${value} 0 += ${node.delta}`,
                    `${result} = ${alias} + ${value}`);
                return result;
            }
            case 'map': {
                const source = child(node.value), fn = name('mapped'), body: string[] = [];
                const result = emit(node.body, 'Input', body, transform);
                definitions.push(`fun Input ${fn} rank 0`, ...body.map(line => ` ${line}`), ` return ${result}`, 'end');
                lines.push(`${value} = ${source} ${fn}`);
                return value;
            }
            case 'local': lines.push(`${value} = ${emit(node.value, input, lines, false)}`); return value;
            case 'lazy': {
                const item = child(node.value), source = name('Source'), first = name('First');
                lines.push(`${source} = ${item}`, `${value}' = ${source} * 2`, `${first} = ${value}`, `${value}' = ${source} * 3`);
                return `(${first} + ${value})`;
            }
            case 'effect': {
                lines.push(`${value} = ${child(node.value)}`, `${value} print`);
                return value;
            }
            case 'helper': case 'higher': case 'capture': case 'protected': case 'generator': {
                const fn = name('helper'), body: string[] = [];
                const result = emit(node.value, 'Input', body, transform);
                definitions.push(`fun Input ${fn}`);
                if (node.kind === 'protected') definitions.push(' try');
                definitions.push(...body.map(line => ` ${line}`));
                if (node.kind === 'capture') {
                    const nested = name('captured');
                    definitions.push(` fun Item ${nested}`, '  return Item + Input', ' end', ` return ${result} ${nested}`);
                }
                else if (node.kind === 'generator') definitions.push(` yield ${result}`, ' try', `  yield ${result} + 1`, ' finally', '  yield 7', ' end');
                else definitions.push(` return ${result}`);
                if (node.kind === 'protected') definitions.push(' finally', ' "closed" print', ' end');
                definitions.push('end');
                if (node.kind === 'higher') {
                    const apply = name('apply');
                    definitions.push(`fun Input ${apply} op`, ' return Input op', 'end');
                    return `(${input} ${apply} ${fn})`;
                }
                if (node.kind === 'generator') {
                    lines.push(`${value} = (${input} ${fn}) array`);
                    return `(${value} sum)`;
                }
                return `(${input} ${fn})`;
            }
            case 'branch': {
                const yes: string[] = [], no: string[] = [];
                const left = emit(node.left, input, yes, transform), right = emit(node.right, input, no, transform);
                lines.push(`${value} = 0`, `if ${input} greater ${node.threshold}`, ...yes.map(line => ` ${line}`), ` ${value} = ${left}`,
                    'else', ...no.map(line => ` ${line}`), ` ${value} = ${right}`, 'end');
                return value;
            }
            case 'loop': {
                const index = name('Index'), body: string[] = [];
                const result = emit(node.value, index, body, transform);
                lines.push(`${value} = 0`, `for ${index} in 1 to ${node.count}`);
                if (node.control !== 'none') lines.push(` if ${index} equal 2`, `  ${node.control}`, ' end');
                lines.push(...body.map(line => ` ${line}`), ` ${value} += ${result}`, 'end');
                return value;
            }
        }
    }
    const lines = [`Input = ${program.input}`];
    const result = emit(program.expression, 'Input', lines);
    lines.push(result);
    return ['use io', 'use algo', 'use sequences', ...definitions, ...lines].join('\n');
}

function pure(node: Scalar): boolean {
    return node.kind === 'literal' || node.kind === 'input'
        || node.kind === 'binary' && pure(node.left) && pure(node.right);
}
export function children(node: Expr): Expr[] {
    if ('left' in node) return [node.left, node.right];
    if (node.kind === 'queue') return node.values;
    if (node.kind === 'map') return [node.value, node.body];
    if ('value' in node && typeof node.value === 'object') return [node.value];
    return [];
}
export function features(node: Expr): string[] {
    return [...new Set([node.kind, ...children(node).flatMap(features)])].sort();
}

/** Smaller, domain-preserving alternatives. Shapes retain their declared rank. */
export function* reductions(node: Expr): Generator<Expr> {
    if (node.type === 'integer') {
        if (node.kind !== 'literal' || node.value !== 0) yield literal();
        for (const child of children(node)) if (child.type === 'integer') yield child;
    } else if (node.type === 'array') {
        yield { type: 'array', kind: 'fill', rank: node.rank, size: 0, value: literal() };
    }
    if (node.kind === 'literal' && Math.abs(node.value) > 1) {
        yield literal(Math.sign(node.value));
        yield literal(Math.trunc(node.value / 2));
    }
    if (node.kind === 'loop' && node.count > 1) yield { ...node, count: 1 };
    if (node.kind === 'fill' && node.size > 0) yield { ...node, size: node.size - 1 };
    if ((node.kind === 'record' || node.kind === 'snapshot') && node.delta) yield { ...node, delta: 0 };
    if (node.kind === 'queue' && node.values.length > 1) {
        for (let index = 0; index < node.values.length; index++) yield { ...node, values: node.values.filter((_, position) => index !== position) };
    }
    for (const key of ['left', 'right', 'value', 'body'] as const) {
        const child = (node as unknown as Record<string, unknown>)[key];
        if (!child || typeof child !== 'object' || !('type' in child)) continue;
        for (const replacement of reductions(child as Expr)) yield { ...node, [key]: replacement } as Expr;
    }
    if (node.kind === 'queue') for (let index = 0; index < node.values.length; index++) {
        for (const replacement of reductions(node.values[index])) {
            if (replacement.type === 'integer') yield { ...node, values: node.values.map((value, position) => position === index ? replacement : value) };
        }
    }
}

export function minimize(program: Program, fails: (candidate: Program) => boolean, budget = 100): { program: Program; attempts: number } {
    let current = program, attempts = 0;
    const seen = new Set([JSON.stringify(program.expression)]);
    const weight = (node: Expr): number => Object.values(node).reduce<number>((sum, value) =>
        sum + (typeof value === 'number' ? Math.abs(value) : 0), 0) + children(node).reduce((sum, child) => sum + weight(child), 0);
    search: while (attempts < budget) {
        const size = print(current).length, magnitude = weight(current.expression);
        for (const expression of reductions(current.expression)) {
            const key = JSON.stringify(expression);
            if (seen.has(key)) continue;
            seen.add(key);
            const candidate = { ...current, expression };
            const candidateSize = print(candidate).length;
            if (candidateSize > size || candidateSize === size && weight(expression) >= magnitude) continue;
            if (attempts >= budget) break search;
            attempts++;
            if (fails(candidate)) { current = candidate; continue search; }
        }
        break;
    }
    return { program: current, attempts };
}
