# Research only: borrow existing normalized Int32 inputs during synchronous read-only folds.
from pathlib import Path
import sys
p=Path(sys.argv[1])/'runtime/modular-fold.js'
s=p.read_text()
old='''    const stored = integer32Cells(value);
    const out = new Int32Array'''
new='''    const stored = integer32Cells(value);
    if (stored) {
        let normalized = true;
        for (let i = 0; i < stored.length; i++) {
            if (stored[i] < 0 || stored[i] >= m) { normalized = false; break; }
        }
        if (normalized) return stored;
    }
    const out = new Int32Array'''
assert old in s;s=s.replace(old,new,1);p.write_text(s)
