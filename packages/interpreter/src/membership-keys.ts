const BLOCK_SIZE = 2 ** 23;

// Keep the native Set path when the input count proves it cannot overflow.
export function membershipKeys<T>(size: number | undefined): Set<T> | MembershipKeys<T> {
    return size !== undefined && size <= BLOCK_SIZE ? new Set<T>() : new MembershipKeys<T>();
}

// V8 limits a Set to 2^24 entries. Seal each block before that limit;
// membership may query several blocks, but never grows one unbounded Set.
export class MembershipKeys<T> {
    private current = new Set<T>();
    private readonly blocks = [this.current];

    constructor(private readonly blockSize = BLOCK_SIZE) {}

    add(value: T): void {
        if (this.current.size === this.blockSize && !this.current.has(value)) {
            this.current = new Set<T>();
            this.blocks.push(this.current);
        }
        // Duplicates in older blocks are harmless; avoid searching every block
        // on insertion, keeping index construction linear in the input size.
        this.current.add(value);
    }

    has(value: T): boolean {
        for (const block of this.blocks) if (block.has(value)) return true;
        return false;
    }

    clear(): void {
        this.current = this.blocks[0];
        this.current.clear();
        this.blocks.length = 1;
    }
}
