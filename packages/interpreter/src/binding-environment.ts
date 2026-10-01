import {
    acceptsBindingType, availableBuiltin, bindingTypeMessage, builtinBindingMessage, possibleBindingTypeConflict,
    settledBindingTypes,
} from '@arrrank/language';
import { RankError } from './errors.js';
import { LocalFrame } from './frame.js';
import { typeName, type RankValue } from './value.js';

/**
 * Where names live while a program runs. Globals and locals are both frames
 * and every write to either passes the same type and rank contract from
 * `binding-rule.ts`. The global frame keeps its values in the public
 * `Interpreter.variables` map, so a host can read and inject them.
 *
 * `current` is the innermost local frame, undefined at top level. A read walks
 * the local chain and then the globals; a write inside a function never
 * reaches a global, it binds a local. Dotted names belong to module aliases,
 * which the facade resolves before reaching here.
 */
export class BindingEnvironment {
    readonly globals: LocalFrame;
    current: LocalFrame | undefined;
    /** Global names written by source, as opposed to values the host injected. */
    readonly sourceBindings = new Set<string>();

    constructor(values: Map<string, RankValue>, private readonly modules: ReadonlySet<string>) {
        this.globals = LocalFrame.over(values);
    }

    /** The frame a new name is bound in. */
    get scope(): LocalFrame {
        return this.current ?? this.globals;
    }

    find(name: string): RankValue | undefined {
        return this.current?.lookup(name) ?? this.globals.get(name);
    }

    withFrame<T>(frame: LocalFrame | undefined, operation: () => T): T {
        const caller = this.current;
        this.current = frame;
        try {
            return operation();
        } finally {
            this.current = caller;
        }
    }

    assign(name: string, value: RankValue): void {
        if (availableBuiltin(name, this.modules)) throw new RankError(builtinBindingMessage(name), 'TypeError');
        const frame = this.current?.find(name) ?? this.current;
        if (!frame) this.sourceBindings.add(name);
        const scope = frame ?? this.globals;
        const received = typeName(value);
        // A variable that already carries a recorded type needs neither its
        // previous value nor a rewrite of the type it keeps.
        const recorded = scope.typeOf(name);
        if (recorded !== undefined) {
            if (!acceptsBindingType(recorded, received)) {
                throw new RankError(bindingTypeMessage(name, recorded, [received], true));
            }
            // A name that has held only `.NA` settles on the type of its first value.
            const settledType = settledBindingTypes(recorded, [received]);
            if (settledType !== recorded) scope.declareType(name, settledType);
            scope.set(name, value);
            return;
        }
        const previous = scope.get(name);
        const expected = previous === undefined ? undefined : new Set([typeName(previous)]);
        if (expected !== undefined && !acceptsBindingType(expected, received)) {
            throw new RankError(bindingTypeMessage(name, expected, [received], true));
        }
        scope.define(name, value, expected === undefined ? new Set([received])
            : settledBindingTypes(expected, [received]));
    }

    // Repeated writes to one name settle on one frame slot, so the site that
    // makes them resolves it once and then stores without hashing the name
    // again. A name that moves scope, changes type or has yet to be defined
    // reports back from store() and takes the full path through assign.
    compileAssign(name: string): (value: RankValue) => void {
        let layout: Map<string, number> | undefined;
        let slot = -1;
        let global: ReadonlySet<string> | undefined;
        return (value: RankValue): void => {
            const received = typeName(value);
            const frame = this.current;
            if (frame === undefined) {
                // A global keeps the types it first settled on, so the site
                // remembers them and the write costs one store rather than a
                // lookup for the types and a second for the value.
                if (global !== undefined && global.has(received)) {
                    this.globals.set(name, value);
                    return;
                }
                this.assign(name, value);
                global = this.globals.typeOf(name);
                return;
            }
            if (layout !== frame.layout) {
                layout = frame.layout;
                slot = layout.get(name) ?? -1;
            }
            if (slot >= 0 && frame.store(slot, value, received)) return;
            this.assign(name, value);
        };
    }

    /** A for loop settles the types its names will take before the first iteration binds them. */
    declareTypes(names: readonly string[], candidates: readonly ReadonlySet<string>[]): void {
        const scope = this.scope;
        names.forEach((name, index) => {
            if (name === '#') return;
            const inferred = candidates[index];
            if (!inferred || inferred.size === 0) return;
            const held = scope.get(name);
            const previous = scope.typeOf(name)
                ?? (held !== undefined ? new Set([typeName(held)]) : undefined);
            if (previous && possibleBindingTypeConflict(previous, inferred)) {
                throw new RankError(bindingTypeMessage(name, previous, inferred, true));
            }
            scope.declareType(name, previous ?? inferred);
        });
    }

    /** A name that ended with its block leaves with its value, type and rank. */
    unbind(name: string): void {
        this.scope.unset(name);
    }

    /** A notebook can replace declarations without relaxing assignment type checks. */
    forget(names: Iterable<string>): void {
        for (const name of names) {
            this.globals.unset(name);
            this.sourceBindings.delete(name);
        }
    }

    /**
     * The structure behind `index`, `queue`, `set` and `counter`: the first
     * use in a scope creates it there, later uses find it again.
     */
    structure<T extends RankValue>(name: string, is: (value: RankValue) => value is T, create: () => T): T {
        const scope = this.scope.values;
        const existing = scope.get(name);
        if (existing !== undefined) {
            if (!is(existing)) throw new RankError(`${name} name is already in use`);
            return existing;
        }
        const created = create();
        scope.set(name, created);
        return created;
    }
}
