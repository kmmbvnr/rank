import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../node_modules/.cache/mlrank', import.meta.url));
execFileSync('uv', ['venv', directory, '--python', '3.12'], { stdio: 'inherit' });
execFileSync('uv', ['pip', 'install', '--python', `${directory}/bin/python`, 'ai-edge-litert==2.3.0', 'numpy==2.5.4'], { stdio: 'inherit' });
