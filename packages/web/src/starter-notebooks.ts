import arrays from './starter-notebooks/01-arrays.ra?raw';
import sequences from './starter-notebooks/02-sequences.ra?raw';
import functions from './starter-notebooks/03-functions.ra?raw';
import { splitSource } from '@arrrank/common/notebook';
import { notebookTitle, type NotebookStore } from './notebook-store.js';

/** Saved examples remain ordinary editable notebooks; opening one never runs it. */
export async function seedStarterNotebooks(store: NotebookStore): Promise<void> {
    const created = Date.now();
    for (const [index, source] of [arrays, sequences, functions].entries()) {
        // Native notebook files require UUID-shaped IDs. Keep them stable across retries.
        const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
        if (await store.get(id)) continue;
        const snapshot = { cells: splitSource(source), draft: '' };
        await store.save({ id, title: notebookTitle(snapshot), manual: false,
            created, updated: created - index - 1, snapshot });
    }
}
