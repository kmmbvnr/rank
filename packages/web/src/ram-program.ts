import { splitSource, type Notebook } from '@arrrank/common/notebook';
import { parse } from '@arrrank/interpreter';
import { isUseStatement } from '@arrrank/language';

/** Insert source only: keep existing results, unfinished input and editor position. */
export function attachRamCall(book: Notebook, name: string): void {
    const active = book.current.id, cursor = book.cursor;
    let imported = false, alias: string | undefined;
    for (const cell of book.cells) {
        if (cell.command) continue;
        for (const source of splitSource(cell.source)) {
            try {
                const statement = parse(source).statements.find(statement => isUseStatement(statement) && statement.path === name);
                if (statement && isUseStatement(statement)) { imported = true; alias = statement.alias; break; }
            } catch { /* Preserve unfinished input even when it cannot be parsed. */ }
        }
        if (imported) break;
    }
    if (!imported) book.insertCell(0, `use "${name}"`);
    const stem = name.replace(/\.ram$/, '');
    const call = `X ${alias ? alias + '.' : ''}${stem}`;
    const draft = book.cells.at(-1)!.source;
    if (draft.trimEnd().split('\n').at(-1)?.trim() !== call) {
        book.selectTo(book.cells.length - 1, draft.length);
        book.replace(draft + (draft && !draft.endsWith('\n') ? '\n' : '') + call);
    }
    book.selectTo(book.cells.findIndex(cell => cell.id === active), cursor);
}
