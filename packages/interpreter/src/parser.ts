import { AstUtils, EmptyFileSystem } from 'langium';
import type { Program } from '@arrrank/language';
import {
    createRankServices, expressionDiagnostics, isTextBlockExpression, textBlockModeError, type GroupingOptions,
} from '@arrrank/language';
import { RankError } from './errors.js';

const services = createRankServices(EmptyFileSystem).Rank;

export function parse(source: string, sourceId = '<input>', grouping: GroupingOptions = {}): Program {
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
        const diagnostic = new RankError(`${error.message}${location}`, 'Syntax');
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
    return result.value;
}
