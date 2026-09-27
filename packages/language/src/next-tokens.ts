import { EmptyFileSystem } from 'langium';
import { findNextFeatures } from 'langium/lsp';
import { createRankServices } from './rank-module.js';

type Services = ReturnType<typeof createRankServices>['Rank'];
let services: Services | undefined;
const cache = new Map<string, ReadonlySet<string>>();

/**
 * The tokens the grammar accepts right after `source`: keyword texts and
 * terminal names such as `WORD`. Only syntax counts; names and arities do not.
 */
export function nextTokens(source: string): ReadonlySet<string> {
    const cached = cache.get(source);
    if (cached) return cached;
    services ??= createRankServices(EmptyFileSystem).Rank;
    // A statement ahead gives the parser a rule to continue from, even at the start.
    const result = services.parser.CompletionParser.parse('X\n' + source);
    const stack = result.elementStack.map(feature => ({ feature }));
    const features = findNextFeatures([stack], [...result.tokens].splice(result.tokenIndex));
    const tokens = new Set(features.map(({ feature }) => 'value' in feature ? String(feature.value)
        : 'rule' in feature ? (feature.rule as { ref?: { name: string } }).ref?.name ?? '' : ''));
    if (cache.size > 64) cache.clear();
    cache.set(source, tokens);
    return tokens;
}

/**
 * Whether the first token of `text` can follow `source`. Later tokens are not
 * checked: the completion parser loses track inside two-word operators.
 */
export function acceptsNext(source: string, text: string): boolean {
    services ??= createRankServices(EmptyFileSystem).Rank;
    const token = services.parser.Lexer.tokenize(text).tokens[0];
    return !!token && nextTokens(source).has(token.tokenType.name);
}
