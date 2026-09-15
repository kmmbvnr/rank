# Rank mobile

The Android and iOS projects embed the exact build produced by `@arrrank/web`.
The mobile build rebuilds that workspace before synchronizing the native
projects:

```sh
npm run build --workspace @arrrank/mobile
```

Native Rank capabilities belong in Capacitor plugins under this package. The
browser UI and language runtime stay in `@arrrank/web`, `@arrrank/interpreter`
and `@arrrank/language`.
