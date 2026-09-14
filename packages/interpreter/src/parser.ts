import { EmptyFileSystem } from 'langium';
import type { Program } from '@rank/language';
import { createRankServices } from '@rank/language';
import { RankError } from './errors.js';

const services = createRankServices(EmptyFileSystem).Rank;

export function parse(source: string, sourceId = '<input>'): Program {
    const result = services.parser.LangiumParser.parse<Program>(source);
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

    return result.value;
}
