import type { FunctionStatement } from './generated/ast.js';

export type DeclaredRank = number | 'all';

export interface DeclaredRanks {
    readonly ranks: readonly DeclaredRank[];
    readonly error?: undefined;
}

/**
 * The cell ranks a `fun` header declares with `rank L R`, one per parameter.
 * `all` takes the whole operand and a negative number counts down from its rank.
 * Returns undefined without a clause and an error message for an invalid one.
 */
export function declaredRanks(statement: FunctionStatement): DeclaredRanks | string | undefined {
    const specs = statement.ranks;
    if (!specs || specs.length === 0) return undefined;
    const count = statement.parameters.length;
    if (count === 0) return 'rank needs a function with parameters';
    if (count > 2) return 'rank is defined for functions of one or two parameters';
    if (specs.length !== count) {
        return `rank expects ${count} ${count === 1 ? 'entry' : 'entries'} for ${count} ${count === 1 ? 'parameter' : 'parameters'}, got ${specs.length}`;
    }
    const ranks: DeclaredRank[] = [];
    for (const spec of specs) {
        if (spec === 'all') { ranks.push('all'); continue; }
        if (!/^-?[0-9]+$/.test(spec)) return `rank expects an integer or \`all\`, got \`${spec}\``;
        const value = Number(spec);
        if (!Number.isSafeInteger(value)) return 'rank is too large: ' + spec;
        ranks.push(value);
    }
    return { ranks };
}
