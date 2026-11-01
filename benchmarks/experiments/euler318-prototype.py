"""Build an isolated JS-output experiment; does not edit interpreter sources."""
import argparse, pathlib, shutil
p = argparse.ArgumentParser()
p.add_argument('destination', type=pathlib.Path)
p.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[2])
p.add_argument('--kind', choices=['log', 'safe-fallback'], default='log')
a = p.parse_args()
root, dest = a.root.resolve(), a.destination.resolve()
dest.mkdir()  # Require a new directory, never replace an existing checkout.
(dest/'packages/interpreter').mkdir(parents=True)
shutil.copytree(root/'packages/interpreter/out', dest/'packages/interpreter/out')
for source, target in [('node_modules','node_modules'), ('packages/language','packages/language'), ('demos','demos')]:
    (dest/target).symlink_to(root/source, target_is_directory=True)
path = dest/'packages/interpreter/out/jit/integer-loop-expressions.js'
s = path.read_text()
assert "BigInt(Math.trunc(raw_" in s, 'Use a built 68546f1b checkout for historical prototypes'
if a.kind == 'log':
    old = "['floor', bound('floor')],"
    new = """['log', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        domain: { test: value => `!Number.isFinite(Number(${value})) || !(${value} > 0)`, message: 'log input is outside its domain' },
        code: value => `Math.log(Number(${value}))` }],
    ['floor', bound('floor')],"""
else:
    old = 'if (!state.canCallout(source, hint))'
    new = "if ([...state.assigned].some(name => localTypes.get(name) === 'real') || !state.canCallout(source, hint))"
assert s.count(old) == 1, 'Compiler output changed; review the experiment'
path.write_text(s.replace(old, new))
print(dest)
