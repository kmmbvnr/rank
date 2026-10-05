# Agent notes

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
