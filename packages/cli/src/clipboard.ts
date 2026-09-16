import { execFile } from 'node:child_process';
import type { Clipboard } from './key-router.js';

type Run = (file: string, args: string[], input?: string) => Promise<string>;

const run: Run = (file, args, input) => new Promise((resolve, reject) => {
    const child = execFile(file, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on('error', () => { /* Process failures are reported by execFile. */ });
    child.stdin?.end(input ?? '');
});

/** Pass clipboard text through stdin, never through a shell command. */
export function systemClipboard(platform = process.platform, env = process.env, execute: Run = run): Clipboard {
    if (platform === 'darwin') return {
        read: () => execute('pbpaste', []),
        write: async text => { await execute('pbcopy', [], text); },
    };
    if (platform === 'win32') return {
        read: () => execute('powershell.exe', ['-NoProfile', '-Command', '[Console]::Out.Write((Get-Clipboard -Raw))']),
        write: async text => { await execute('powershell.exe', ['-NoProfile', '-Command',
            'Set-Clipboard -Value ([Console]::In.ReadToEnd())'], text); },
    };
    if (env.WAYLAND_DISPLAY) return {
        read: () => execute('wl-paste', ['--no-newline']),
        write: async text => { await execute('wl-copy', [], text); },
    };
    return {
        read: () => execute('xclip', ['-selection', 'clipboard', '-o']),
        write: async text => { await execute('xclip', ['-selection', 'clipboard'], text); },
    };
}
