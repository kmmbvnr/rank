import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { hasNativeFenwick, type RankFenwick } from '../fenwick.js';
import { isRankIndex, type RankIndex } from '../value.js';
import type { IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';
import { PrivateNumberFenwick } from './number-loop-fenwick.js';
import { hasPrivateIndexStorage, PrivateIntegerIndex } from './number-loop-index.js';

/** Boundary operations only: generated accesses retain their concrete backend.
 * Publication is total and cannot poll or call user code. Success and ordinary
 * errors publish completed stores; speculative overflow rolls back before replay.
 * Preparation must not mutate source state, even if a later proof fails. */
export interface NumberContainerTransaction {
    publish(): void;
    rollback(): void;
}

/** Semantic integer cells do not imply a safe Number representation. An index
 * keeps exact backing values and guards each numeric load. A Fenwick snapshot
 * proves all cells and nodes safe, but prefix sums and updates remain checked.
 * Neither fact changes the plan's existing BigInt scalar registers. */
type ContainerStorage =
    | { kind: 'index'; source: RankIndex; range: 'checked-load' }
    | { kind: 'fenwick'; source: RankFenwick; range: 'checked-snapshot' };

interface ContainerProof {
    storage: ContainerStorage;
    slots: number[];
    copyCells: number;
    preparationPolls: boolean;
}

export function supportsNumberContainer(kind: string): boolean {
    return kind === 'index' || kind === 'fenwick';
}

/** Deduplicate by native storage identity, not by variable name. These facts
 * describe semantic eligibility and preparation work; no copy threshold lives
 * here. Mutable protection is still checked at the original store boundary. */
export function inspectNumberContainers(plan: IntegerLoopPlan, host: LoopHost): ContainerProof[] | undefined {
    const proofs = new Map<object, ContainerProof>();
    for (const [name, info] of plan.containers) {
        const source = host.read(name);
        let storage: ContainerStorage, identity: object, copyCells: number;
        if (info.kind === 'fenwick' && hasNativeFenwick(source)) {
            storage = { kind: 'fenwick', source, range: 'checked-snapshot' };
            identity = source;
            copyCells = source.size * 2 + 1;
        } else if (info.kind === 'index' && source && isRankIndex(source) && hasPrivateIndexStorage(source)) {
            storage = { kind: 'index', source, range: 'checked-load' };
            identity = source.entries;
            copyCells = 0;
        } else return recordFallback('number-loop:container-storage', 'representation');
        const existing = proofs.get(identity);
        if (existing) existing.slots.push(info.slot);
        else proofs.set(identity, { storage, slots: [info.slot], copyCells,
            preparationPolls: storage.kind === 'fenwick' });
    }
    return [...proofs.values()];
}

/** Allocate only after the independent profitability decision. Alias slots
 * receive one transaction. No dispatcher is introduced inside generated loops. */
export function prepareNumberContainers(proofs: readonly ContainerProof[], input: unknown[], overflow: object): NumberContainerTransaction[] | undefined {
    const transactions: NumberContainerTransaction[] = [];
    for (const { storage, slots } of proofs) {
        let transaction: NumberContainerTransaction;
        if (storage.range === 'checked-load') transaction = new PrivateIntegerIndex(storage.source, overflow);
        else {
            const snapshot = storage.source.numberSnapshot();
            if (!snapshot) return recordFallback('number-loop:container-range', 'representation');
            const diagnostics = currentDiagnostics();
            if (diagnostics) {
                const cost = diagnostics.cost('number-loop.snapshot');
                const bytes = snapshot.values.byteLength + snapshot.tree.byteLength;
                cost.allocatedBytes += bytes;
                cost.copiedBytes += bytes;
            }
            transaction = new PrivateNumberFenwick(storage.source, snapshot, overflow);
        }
        transactions.push(transaction);
        for (const slot of slots) input[slot] = transaction;
    }
    return transactions;
}
