# Agent notes

## Rank coding style

- Prefer array operations when they simplify code.
- Use existing library functions.
- Chain operations when they read clearly.
- Keep only useful intermediate variables.
- Avoid unnecessary conversions and brackets.
- Use short, meaningful names.
- Keep function parameters few and meaningful.
- Prefer at most 40 characters per line,
  including comments.
- Prefer assigning each variable once.
  In CPU code, reassign when simpler.
- Comment on intent, not obvious steps.
- Verify behavior with examples and edge cases.

## Issue-based task workflow

- Do not create or update GitHub issues, post comments, or open pull requests
  on your own initiative. Ask whether to create, update or comment after the
  discussion has reached a useful conclusion, unless the user has explicitly
  requested that action. Write GitHub content in English.
- Use the issue as the working agreement: describe the problem, expected
  behavior and short acceptance criteria. For ordinary tasks, do not create
  separate specification or ADR documents unless the user asks for them.
- When the user authorizes an issue update, write a consolidated summary of
  agreed decisions, relevant implementation findings, verification and
  follow-up ideas. Distinguish decisions from open questions. Do not post a
  separate comment for every suggestion, intermediate finding or chat turn.
- Ask before creating a follow-up issue or posting a final results comment;
  previous permission for another GitHub action is not blanket authorization.
- Keep existing user-facing documentation consistent with implemented behavior.

## Running tests

Run ordinary suites through the package scripts, not `npx vitest run` on the
whole package. `packages/interpreter/scripts/test.mjs` and
`packages/common/scripts/test.mjs` pick the audit config, limit workers and
drain RPC reports; a bare `vitest run` skips that, and long synchronous tests
then time out (the two `scalar-function-kernel` speculative number mode tests
took 9-13 s against a 5 s limit).

The exhaustive audits are slow. Do not start them on your own, and do not run
the full `npm test` after each change: ask the user first. They run in CI.

| Audit | File | Time |
| --- | --- | --- |
| Inferred types against runs | `packages/interpreter/test/types.test.ts` | about 30 min |
| Name facts over every demo | `packages/common/test/name-facts-corpus.test.ts` | about 30 min |
| Differential | `packages/interpreter/test/differential.test.ts` | not measured |
| Nurikabe | `packages/interpreter/test/nurikabe.test.ts` | about 90 s |

The 30 min figures are one unsharded `vitest run` on a 10-core Mac with the
other suites running at the same time, so treat them as an upper bound. The
package scripts shard these audits across processes when the machine allows.
Other slow files in the same run: `full-scale-demos.test.ts` about 95 s,
`parser-memory.test.ts` about 60 s, `compiled-integer-collections.test.ts` and
`concat-depth.test.ts` about 50 s each.

For a quick check after a change, run the ordinary suite with the audits
excluded, from the package directory:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  --config ./scripts/type-audit.config.mjs --maxWorkers 4 \
  --exclude test/types.test.ts --exclude test/differential.test.ts \
  --exclude test/nurikabe.test.ts
```

For a single file, pass its path instead of the excludes.

## Building and installing the Android APK

Android Studio is installed, but Java and `adb` are not on `PATH`. Use the
JDK and SDK that Android Studio bundles:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
ADB=~/Library/Android/sdk/platform-tools/adb
```

Build the web console in mobile mode, sync Capacitor and assemble a debug APK:

```sh
npm run android:apk --workspace @arrrank/mobile
```

The script first runs `tsc -b tsconfig.build.json`: the web build consumes the
compiled `packages/*/out`, so a stale `out/` gives an APK without the latest
interpreter changes.

Without `JAVA_HOME`, the Gradle step fails with "Unable to locate a Java
Runtime". The APK is written to
`packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Connect the phone, then check that it is listed as `device`:

```sh
$ADB devices -l
```

- USB: enable Developer options and USB debugging on the phone, plug it in
  and accept the "Allow USB debugging" prompt. `unauthorized` means the prompt
  is still waiting on the phone.
- Wireless (Android 11+, same Wi-Fi): Developer options → Wireless debugging →
  "Pair device with pairing code", then run `$ADB pair IP:PAIR_PORT CODE` and
  `$ADB connect IP:PORT` using the port shown on the Wireless debugging screen
  itself, not the pairing port. Once paired (Android Studio's pairing counts),
  later sessions only need `$ADB connect IP:PORT`; the port changes each time
  Wireless debugging is turned on. The developer's phone is usually at
  `192.168.1.101`.

Install over the existing app, keeping its data, and launch it:

```sh
$ADB install -r packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
$ADB shell monkey -p com.arrrank.app 1
```

With several devices attached, add `-s SERIAL` after `$ADB`. An
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` error means a differently signed build is
installed: uninstall it first, which deletes the app's local notebooks.
