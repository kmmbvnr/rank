import type { AstNode } from 'langium';
import {
    analyzeFunctionScopes, bindingMutationSites, isForStatement, isFunctionStatement, isProgram, isStatement,
    type LexicalBinding, type Program, type Statement,
} from '@arrrank/language';
import type { PreparedStatement } from './statement-control.js';

interface MutationTarget { readonly name: string; readonly local: boolean; readonly node: AstNode }

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
            for (const binding of bindings) this.checkTarget({ name: binding.name, local: false, node });
        }
    }

    statement(statement: Statement): void {
        for (const target of this.statementTargets(statement)) this.checkTarget(target);
    }

    wrap(statement: Statement, prepared: PreparedStatement): PreparedStatement {
        const targets = this.statementTargets(statement);
        if (!targets.length) return prepared;
        // The syntax and binding scopes are fixed, but protection can change
        // between calls or while a statement is suspended. Check it every time.
        const check = (): void => { for (const target of targets) this.checkTarget(target); };
        return 'run' in prepared
            ? { ...prepared, run: context => { check(); return prepared.run(context); } }
            : { ...prepared, stream: context => { check(); return prepared.stream(context); } };
    }

    private statementTargets(statement: Statement): readonly MutationTarget[] {
        let targets = this.targets.get(statement);
        if (!targets) {
            this.index(statement);
            targets = this.targets.get(statement) ?? [];
            this.targets.set(statement, targets);
        }
        return targets;
    }

    private checkTarget(target: MutationTarget): void {
        try { this.check(target.name, target.local); }
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
        for (const [statement, bindings] of targets) this.targets.set(statement, [...bindings].map(([binding, node]) => ({
            name: binding.name, local: isFunctionStatement(binding.scope.owner), node,
        })));
    }
}
