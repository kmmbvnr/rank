// Run against Vite with playwright-cli run-code --filename this file.
async page => {
    return await page.evaluate(async () => {
        const { browserSession } = await import('/src/session.ts');
        const failures = [];
        const session = browserSession(message => failures.push(message), () => {});
        const check = (ok, message) => { if (!ok) throw new Error(message); };
        const execute = source => session.execute(source, 0, [], 40, true);
        const output = result => result.output.map(line => line.text).join('\n');
        try {
            check(output(await execute('use cli\n"HOST" env default "empty"')) === 'empty', 'Browser environment must start empty');
            check((await execute('env "HOST" = "session"')).ok, 'Literal write failed');
            check((await execute('Name = "HOST"\ne = env\ne Name = "alias"')).ok, 'Alias write failed');
            check(output(await execute('Name env')) === 'alias', 'Read did not observe the write');
            const preview = await session.preview('env Name = "preview"\nName env');
            check(preview.ok && output(preview) === 'preview', 'Preview did not observe its overlay');
            check(output(await execute('Name env')) === 'alias', 'Preview changed the session');
            await session.resetExecution();
            check(output(await execute('use cli\n"HOST" env')) === 'alias', 'Clean restart lost the environment');
            check((await execute('env "HOST" = .NA')).ok, 'Deletion failed');
            check(output(await execute('"HOST" env default "absent"')) === 'absent', 'Deletion did not remove the value');
            await execute('env "HOST" = "again"');
            await session.resetExecution(true);
            check(output(await execute('use cli\n"HOST" env default "empty"')) === 'empty', 'Notebook boundary retained environment values');
            check(failures.length === 0, failures.join('\n'));
            return 'Browser worker: empty initial environment, writes, aliases, reads, preview isolation, deletion, clean restart and notebook reset passed';
        } finally { session.dispose(); }
    });
}
