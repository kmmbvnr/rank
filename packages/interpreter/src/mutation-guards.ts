import type { AstNode } from 'langium';
import {
    analyzeFunctionScopes, bindingMutationSites, isForStatement, isFunctionStatement, isProgram, isStatement,
    type LexicalBinding, type Program, type Statement,
} from '@arrrank/language';
import type { PreparedStatement } from './statement-control.js';

interface MutationTarget { readonly binding: LexicalBinding; readonly node: AstNode }

/** Syntax-only mutation targets, shared by ordinary, resumed and compiled entry.
 * The check reads current scope protection; no value identity or result is cached. */
export class MutationGuards {
    private readonly prepared = new WeakSet<Program>();
    private readonly targets = new WeakMap<Statement, readonly MutationTarget[]>();

    constructor(
        private readonly check: (name: string, local: boolean) => void,
        private readonly locate: (error: unknown, node: AstNode) => unknown,
    ) {}

    /** Earlier notebook cells are checked before any effects of this program. */
    program(program: Program): void {
        this.index(program);
        const analysis = analyzeFunctionScopes(program);
        for (const [node, bindings] of bindingMutationSites(analysis)) {
            if (analysis.scopes.get(node)?.owner !== program) continue;
            for (const binding of bindings) this.checkTarget({ binding, node }, false);
        }
    }

    statement(statement: Statement): void {
        this.index(statement);
        for (const target of this.targets.get(statement) ?? []) {
            this.checkTarget(target, isFunctionStatement(target.binding.scope.owner));
        }
    }

    wrap(statement: Statement, prepared: PreparedStatement): PreparedStatement {
        this.index(statement);
        if (!this.targets.get(statement)?.length) return prepared;
        return 'run' in prepared
            ? { ...prepared, run: context => { this.statement(statement); return prepared.run(context); } }
            : { ...prepared, stream: context => { this.statement(statement); return prepared.stream(context); } };
    }

    private checkTarget(target: MutationTarget, local: boolean): void {
        try { this.check(target.binding.name, local); }
        catch (error) { throw this.locate(error, target.node); }
    }

    private index(node: AstNode): void {
        while (node.$container) node = node.$container;
        if (!isProgram(node) || this.prepared.has(node)) return;
        this.prepared.add(node);
        const analysis = analyzeFunctionScopes(node);
        const targets = new Map<Statement, Map<LexicalBinding, AstNode>>();
        for (const [site, bindings] of bindingMutationSites(analysis)) {
            let statement: AstNode | undefined = site;
            while (statement && !isStatement(statement)) statement = statement.$container;
            if (!statement || !isStatement(statement)) continue;
            const add = (target: Statement): void => {
                const names = targets.get(target) ?? new Map();
                for (const binding of bindings) if (!names.has(binding)) names.set(binding, site);
                targets.set(target, names);
            };
            add(statement);
            // A compiled loop can bypass individual body statements. Its entry
            // checks the same writes, excluding nested function declarations.
            for (let parent = statement.$container; parent && !isFunctionStatement(parent); parent = parent.$container) {
                if (isForStatement(parent)) add(parent);
            }
        }
        for (const [statement, bindings] of targets) this.targets.set(statement, [...bindings].map(([binding, node]) => ({ binding, node })));
    }
}
