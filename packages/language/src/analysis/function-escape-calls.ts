import type { FunctionStatement } from '../generated/ast.js';
import type { LexicalBinding } from './function-scopes.js';

export type Flow = { functions: Set<FunctionStatement>; lazy: Set<FunctionStatement>; stored: Set<FunctionStatement> };
export type Environment = Map<LexicalBinding, Flow>;
export const empty = (): Flow => ({ functions: new Set(), lazy: new Set(), stored: new Set() });
export function union(values: readonly Flow[]): Flow {
    return { functions: new Set(values.flatMap(value => [...value.functions])),
        lazy: new Set(values.flatMap(value => [...value.lazy])),
        stored: new Set(values.flatMap(value => [...value.stored])) };
}

/** Add provenance monotonically; recursive call summaries have a finite domain. */
function merge(target: Flow, source: Flow): boolean {
    let changed = false;
    for (const field of ['functions', 'lazy', 'stored'] as const) for (const fn of source[field]) {
        if (!target[field].has(fn)) { target[field].add(fn); changed = true; }
    }
    return changed;
}

type Call = {
    fn: FunctionStatement; args: Flow[]; outer: Environment;
    result: Flow; effects: Flow[]; dependents: Set<Call>;
};

/** Reuse calls by abstract inputs, including lexical state. Revisit callers when
 * recursive results or container writes grow, rather than unfolding call paths. */
export function escapeCalls(evaluate: (fn: FunctionStatement, args: readonly Flow[], outer: Environment) => Flow) {
    const calls = new Map<string, Call>();
    const pending = new Set<Call>();
    const ids = new Map<FunctionStatement | LexicalBinding, number>();
    const id = (object: FunctionStatement | LexicalBinding): number => {
        if (!ids.has(object)) ids.set(object, ids.size);
        return ids.get(object)!;
    };
    const signature = (flow: Flow): string => [flow.functions, flow.lazy, flow.stored]
        .map(set => [...set].map(id).sort((a, b) => a - b).join(',')).join('/');
    let current: Call | undefined;
    const run = (call: Call): void => {
        pending.delete(call);
        const { args, outer } = snapshot(call.args, call.outer);
        const previous = current;
        current = call;
        try {
            const result = evaluate(call.fn, args, outer);
            let changed = merge(call.result, result);
            const effects = [...args, ...outer.values()];
            effects.forEach((flow, index) => { if (merge(call.effects[index], flow)) changed = true; });
            if (changed) for (const dependent of call.dependents) pending.add(dependent);
        } finally { current = previous; }
    };
    return (fn: FunctionStatement, args: readonly Flow[], outer: Environment): Flow => {
        const environment = [...outer].filter(([binding]) => binding.scope.owner !== fn)
            .sort(([a], [b]) => id(a) - id(b));
        // Equal provenance does not imply aliasing: writing A can affect B only
        // when the caller supplied the same container for both parameters.
        const aliases = new Map<Flow, number>();
        const input = (flow: Flow): [string, number] => {
            if (!aliases.has(flow)) aliases.set(flow, aliases.size);
            return [signature(flow), aliases.get(flow)!];
        };
        const key = JSON.stringify([id(fn), args.map(input), environment.map(([binding, flow]) => [id(binding), input(flow)])]);
        let call = calls.get(key);
        if (!call) {
            call = { fn, ...snapshot(args, new Map(environment)),
                result: empty(), effects: [...args, ...environment.map(([, flow]) => flow)].map(() => empty()), dependents: new Set() };
            calls.set(key, call);
            if (current) call.dependents.add(current);
            run(call);
        } else if (current) call.dependents.add(current);
        if (!current) while (pending.size) run(pending.values().next().value!);
        // Calls may store lazy callbacks in argument containers or captured state.
        [...args, ...environment.map(([, flow]) => flow)].forEach((flow, index) => merge(flow, call.effects[index]));
        return union([call.result]);
    };
}

/** Preserve aliases while isolating cached inputs from later container writes. */
function snapshot(args: readonly Flow[], outer: Environment) {
    const copies = new Map<Flow, Flow>();
    const copy = (flow: Flow): Flow => {
        if (!copies.has(flow)) copies.set(flow, union([flow]));
        return copies.get(flow)!;
    };
    return { args: args.map(copy), outer: new Map([...outer].map(([binding, flow]) => [binding, copy(flow)])) };
}
