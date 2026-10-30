"""Independent set-growth oracle, with no Redelmeier state or pruning bounds."""
import json, subprocess, os
from pathlib import Path
root = Path(__file__).resolve().parent.parent
shapes = {frozenset({(0, 1)})}
for n in range(1, 9):
    if n > 1:
        following = set()
        for shape in shapes:
            for x, y in shape:
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    cell = (x+dx,y+dy)
                    if cell[1] >= 1 and cell not in shape:
                        following.add(shape | {cell})
        shapes = following
    balanced = set()
    for shape in shapes:
        if sum(x for x, _ in shape) == 0:
            balanced.add(min(tuple(sorted(shape)), tuple(sorted((-x,y) for x,y in shape))))
    expected = len(balanced)
    for mode in ('reference','compiled'):
        for variant in os.environ.get('VARIANTS','original,early-break,lean,native-cache,early-break-native-cache,lean-native-cache,shipping').split(','):
            result = subprocess.run(['node','benchmarks/euler275-investigation.mjs',mode,str(n),variant],cwd=root,capture_output=True,text=True,check=True,timeout=30)
            row = json.loads(result.stdout)
            assert int(row['answer']) == expected, (n,mode,variant,row,expected)
            print(json.dumps({'n':n,'mode':mode,'variant':variant,'answer':expected}),flush=True)
