"""Build isolated interpreter snapshots sharing the unchanged language/dependencies."""
import pathlib, subprocess, tempfile
repo = pathlib.Path(__file__).resolve().parents[2]
root = pathlib.Path(tempfile.gettempdir()) / 'rank275-comparison'
subprocess.run(['git', 'diff', '--quiet', '7749fbf9', '40adaba7', '--',
                'packages/language', 'package-lock.json'], cwd=repo, check=True)
for rev in ['7749fbf9', 'e3358470', '40adaba7']:
    target = root / rev
    target.mkdir(parents=True, exist_ok=True)
    archive = subprocess.run(['git', 'archive', rev, 'packages/interpreter/src',
        'packages/interpreter/tsconfig.json', 'packages/interpreter/package.json',
        'tsconfig.json', 'package.json'], cwd=repo, stdout=subprocess.PIPE, check=True)
    subprocess.run(['tar', '-x', '-C', str(target)], input=archive.stdout, check=True)
    for source, link in [(repo / 'node_modules', target / 'node_modules'),
                         (repo / 'packages/language', target / 'packages/language')]:
        if not link.exists():
            link.symlink_to(source)
    subprocess.run(['node', 'node_modules/typescript/bin/tsc', '-b',
                    str(target / 'packages/interpreter/tsconfig.json')], cwd=repo, check=True)
    print(rev, 'built', flush=True)
