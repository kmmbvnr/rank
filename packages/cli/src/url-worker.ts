// Keep the interpreter's synchronous I/O contract while fetch runs in its own
// process. No shell parses the URL, and HTTP failures never become file text.
try {
    const url = new URL(process.argv[2]);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Expected an HTTP or HTTPS URL');
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    process.stdout.write(new Uint8Array(await response.arrayBuffer()));
} catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
export {};
