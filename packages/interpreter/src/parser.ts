import { AstUtils, EmptyFileSystem } from 'langium';
import type { Program } from '@arrrank/language';
import {
    blockScopeDiagnostics, createRankServices, expressionDiagnostics, isTextBlockExpression, textBlockModeError, type GroupingOptions,
} from '@arrrank/language';
import { RankError } from './errors.js';

const services = createRankServices(EmptyFileSystem).Rank;

/** Former spellings the grammar no longer accepts, with what replaced them. */
function removedSpelling(error: object): string | undefined {
    const { token, previousToken } = error as { token?: { image?: string }; previousToken?: { image?: string } };
    // The count is missing after the keyword, or the keyword follows its count.
    const clause = [previousToken?.image, token?.image].find(image => image === 'take' || image === 'drop');
    if (clause) return `${clause} takes its count after it: write \`Values ${clause} 5\``;
    return undefined;
}

function distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        let diagonal = row[0]!;
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const above = row[j]!;
            row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return row[b.length]!;
}

const ASSIGNMENTS = new Set(['=', '+=', '-=', '*=', '**=', '/=', '//=', 'mod=', 'and=', 'or=', 'xor=']);

/** A lowercase word before an assignment is a name that cannot be a variable: names start with a capital. */
function lowercaseVariable(error: object, source: string): string | undefined {
    const { token } = error as { token?: { image?: string; startOffset?: number } };
    if (!token?.image || !ASSIGNMENTS.has(token.image)) return undefined;
    const line = source.slice(source.lastIndexOf('\n', (token.startOffset ?? 0) - 1) + 1, token.startOffset ?? 0);
    // `index Key = Value` wrote the retired implicit index.
    if (token.image === '=' && /^\s*index\s+\S/.test(line)) {
        return "Unexpected '=': a bare `index` is no longer an implicit index: create one with `Cache = new index`, then write `Cache Key = Value`";
    }
    // Only a lone name at the start of the statement; `Xs i = 3` and similar keep the plain message.
    const name = /^\s*([a-z][A-Za-z0-9_]*)\s*$/.exec(line)?.[1];
    if (!name) return undefined;
    return `Unexpected '${token.image}': variable names start with a capital letter, write \`${name[0].toUpperCase()}${name.slice(1)}\` instead of \`${name}\``;
}

/** A short message for a parser or lexer error, never the parser's own expectation text. */
function readableSyntaxError(error: object, source: string): string {
    const { message, name, token } = error as { message: string; name?: string; token?: { image?: string; startOffset?: number } };
    if (!('token' in error)) {
        if (/unexpected character: ->"<-/.test(message)) return 'Text is missing its closing quote';
        const character = /unexpected character: ->(.*?)<-/s.exec(message)?.[1];
        if (character === '%') return "Unexpected character '%': the remainder is written `mod`, as in `N mod 3` or `Total mod= 7`";
        return character ? `Unexpected character '${character}'` : 'Unexpected character';
    }
    const image = token?.image ?? '';
    if (!image || name === 'NotAllInputParsedException' && image === 'EOF') return 'Unexpected end of input';
    if (/^\s*$/.test(image)) return 'Unexpected end of line';
    let text = `Unexpected '${image}'`;
    if (image === 'at') {
        const next = /^\s*([A-Za-z]+)/.exec(source.slice((token?.startOffset ?? 0) + image.length))?.[1]?.toLowerCase();
        const close = next && ['least', 'most'].find(word => word !== next && distance(word, next) <= 2);
        if (close) text += `, did you mean 'at ${close}'?`;
    }
    return text;
}

export function parse(
    source: string, sourceId = '<input>', grouping: GroupingOptions = {}, known?: ReadonlySet<string>,
    syntheticNames?: ReadonlySet<string>,
): Program {
    const result = services.parser.LangiumParser.parse<Program>(source, { ...grouping, rule: 'Program' });
    const error = result.lexerErrors[0] ?? result.parserErrors[0];

    if (error) {
        const lexerLocation = 'line' in error
            ? { line: error.line, column: error.column }
            : undefined;
        const parserLocation = 'token' in error
            ? error.token as { startLine?: number; startColumn?: number }
            : undefined;
        let line = lexerLocation?.line ?? parserLocation?.startLine;
        let column = lexerLocation?.column ?? parserLocation?.startColumn;
        if (!Number.isFinite(line) || !Number.isFinite(column)) {
            const lines = source.split('\n');
            line = lines.length;
            column = lines.at(-1)!.length + 1;
        }
        const location = ` at ${line}:${column}`;
        const diagnostic = new RankError(`${removedSpelling(error) ?? lowercaseVariable(error, source) ?? readableSyntaxError(error, source)}${location}`, 'Syntax');
        diagnostic.location = {
            sourceId, line: line!, column: column!,
            sourceLine: source.split(/\r?\n/)[line! - 1] ?? '',
        };
        throw diagnostic;
    }

    for (const node of AstUtils.streamAllContents(result.value)) {
        const message = isTextBlockExpression(node) ? textBlockModeError(node) : undefined;
        if (!message) continue;
        const error = new RankError(message, 'Syntax');
        const start = node.$cstNode?.range.start;
        error.location = {
            sourceId, line: (start?.line ?? 0) + 1, column: (start?.character ?? 0) + 1,
            sourceLine: source.split(/\r?\n/)[start?.line ?? 0] ?? '',
        };
        throw error;
    }

    const groupingError = expressionDiagnostics(result.value)[0];
    if (groupingError) {
        const error = new RankError(groupingError.message, 'Syntax');
        const start = groupingError.cst?.range.start;
        error.location = {
            sourceId, line: (start?.line ?? 0) + 1, column: (start?.character ?? 0) + 1,
            sourceLine: source.split(/\r?\n/)[start?.line ?? 0] ?? '',
        };
        throw error;
    }
    const scopeError = blockScopeDiagnostics(result.value, known, syntheticNames)[0];
    if (scopeError) {
        const error = new RankError(scopeError.message, 'Scope');
        const start = scopeError.node.$cstNode?.range.start;
        error.location = {
            sourceId, line: (start?.line ?? 0) + 1, column: (start?.character ?? 0) + 1,
            sourceLine: source.split(/\r?\n/)[start?.line ?? 0] ?? '',
        };
        throw error;
    }
    return result.value;
}
