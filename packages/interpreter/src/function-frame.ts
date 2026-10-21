import { isRankPlan } from './plan.js';
import { flatArrayBorrowProofs, deferredBindingMessage, type LastArrayUseProof, type FunctionStatement } from '@arrrank/language';
import { isFlatScalarArray, isSharedArray } from './array-storage.js';
import type { BindingEnvironment } from './binding-environment.js';
import { summarizeValue } from './value-summary.js';
import { RankError } from './errors.js';
import { LocalFrame } from './frame.js';
import type { BuiltinRegistry } from './modules/builtins.js';
import { prepareFunction } from './prepared-function.js';
import { isNativeFunction, typeName, type NativeFunction, type RankValue } from './value.js';

interface BorrowProof {
    readonly bindings: ReadonlyMap<string, RankValue | undefined>;
    readonly candidates: ReadonlyMap<number, ReadonlyMap<number, 'bigint' | 'boolean' | 'flat-array'>>;
}

/** Bind call arguments in the defining scope, retaining array ownership and tail-frame rules. */
export class FunctionFrames {
    private readonly transfers = new WeakMap<RankValue[], ReadonlySet<number>>();
    private readonly inputs = new WeakMap<LocalFrame, RankValue[]>();
    private readonly summaries = new WeakMap<RankValue[], readonly (string | undefined)[]>();

    /** Called only after all arguments have been evaluated and the call guarded. */
    transfer(arguments_: RankValue[], names: readonly (LastArrayUseProof | undefined)[]): void {
        const caller = this.bindings.current;
        if (!caller) return;
        const moved = new Set<number>();
        const summaries: (string | undefined)[] = [];
        names.forEach((proof, index) => {
            const name = proof?.name;
            const value = arguments_[index];
            if (!proof || !name || value === undefined || caller.get(name) !== value
                || proof.integerSelectors.some(selector => typeof caller.get(selector) !== 'bigint')
                || !isFlatScalarArray(value) || isSharedArray(value)
                || arguments_.filter(argument => argument === value).length !== 1) return;
            summaries[index] = summarizeValue(value);
            // The caller's argument list also survives for error reporting. Keep
            // its bounded diagnostic text before transferring a parameter onward.
            const inputs = this.inputs.get(caller);
            if (inputs) {
                const saved = [...this.summaries.get(inputs) ?? []];
                inputs.forEach((input, i) => {
                    if (input === value) saved[i] ??= summaries[index];
                });
                this.summaries.set(inputs, saved);
            }
            caller.release(name);
            moved.add(index);
        });
        if (moved.size) {
            this.transfers.set(arguments_, moved);
            this.summaries.set(arguments_, summaries);
        }
    }

    hasTransfers(arguments_: RankValue[]): boolean { return this.transfers.has(arguments_); }

    addCall(error: RankError, statement: FunctionStatement, arguments_: RankValue[]): void {
        error.addCall(statement.name, statement.parameters, arguments_, this.summaries.get(arguments_));
    }

    private readonly globalBorrowProofs = new WeakMap<FunctionStatement, BorrowProof>();
    private readonly localBorrowProofs = new WeakMap<LocalFrame, WeakMap<FunctionStatement, BorrowProof>>();

    constructor(
        private readonly bindings: BindingEnvironment,
        private readonly builtins: BuiltinRegistry,
        private readonly resolveHelper: (fn: NativeFunction, parent: LocalFrame | undefined) => FunctionStatement | undefined,
    ) {}

    create(
        statement: FunctionStatement,
        arguments_: RankValue[],
        parent: LocalFrame | undefined,
        reusable?: LocalFrame,
    ): LocalFrame {
        const prepared = prepareFunction(statement);
        const { signature } = prepared;
        if (arguments_.length !== signature.arity) {
            throw new RankError(
                `${statement.name} expects ${signature.arity} arguments, got ${arguments_.length}`,
            );
        }
        const frame = reusable?.reset() ? reusable
            : new LocalFrame(parent, prepared.layout);
        const candidates = arguments_.some((argument, index) => isFlatScalarArray(argument) && !isSharedArray(argument)
            && !prepared.borrowedParameters.has(signature.parameters[index].name))
            ? this.borrowCandidates(statement, parent) : undefined;
        signature.parameters.forEach(({ name: parameter, index, acceptsFunction, deferred }) => {
            const argument = arguments_[index];
            const guards = candidates?.get(index);
            const borrowed = isFlatScalarArray(argument)
                && (this.transfers.get(arguments_)?.has(index) || prepared.borrowedParameters.has(parameter)
                    || !!guards && [...guards].every(([selector, type]) => type === 'flat-array'
                        ? isFlatScalarArray(arguments_[selector]) : typeof arguments_[selector] === type));
            if (isNativeFunction(argument) && !acceptsFunction) {
                throw new RankError(`Function parameters use lowercase names: ${parameter}`, 'TypeError');
            }
            if (isRankPlan(argument)) frame.set(parameter, argument);
            else frame.define(parameter, argument, new Set([typeName(argument)]), borrowed);
            if (deferred) frame.protectName(parameter, deferredBindingMessage(parameter));
        });
        if (arguments_.some(isFlatScalarArray)) this.inputs.set(frame, arguments_);
        else this.inputs.delete(frame);
        return frame;
    }

    private borrowCandidates(statement: FunctionStatement, parent: LocalFrame | undefined): ReadonlyMap<number, ReadonlyMap<number, 'bigint' | 'boolean' | 'flat-array'>> {
        const cache = parent ? this.localBorrowProofs.get(parent) : this.globalBorrowProofs;
        const current = cache?.get(statement);
        const lookup = (name: string) => parent?.lookup(name) ?? this.bindings.globals.get(name);
        if (current && [...current.bindings].every(([name, value]) => lookup(name) === value)) {
            return current.candidates;
        }
        const bindings = new Map<string, RankValue | undefined>();
        const candidates = flatArrayBorrowProofs(statement, name => {
            // These names bypass ordinary variable lookup in resolve().
            if (name.includes('.') || name === 'index' || name === 'queue'
                || name === 'set' || name === 'counter') return undefined;
            const bound = lookup(name);
            bindings.set(name, bound);
            return bound && isNativeFunction(bound) ? this.resolveHelper(bound, parent) : undefined;
        }, name => {
            const bound = lookup(name);
            bindings.set(name, bound);
            return this.builtins.is(name === 'abs' ? 'numbers' : 'core', name, bound ?? this.builtins.lookup(name)!);
        });
        const proof = { bindings, candidates };
        if (parent) {
            const local = cache ?? new WeakMap<FunctionStatement, BorrowProof>();
            local.set(statement, proof);
            if (!cache) this.localBorrowProofs.set(parent, local);
        } else this.globalBorrowProofs.set(statement, proof);
        return candidates;
    }
}
