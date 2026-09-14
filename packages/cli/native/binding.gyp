{
  "targets": [{
    "target_name": "rank_sqlite_interrupt",
    "sources": ["sqlite-interrupt.cc"],
    "include_dirs": ["<!(node -p \"require('path').dirname(require.resolve('better-sqlite3/package.json'))\")/deps/sqlite3"],
    "cflags_cc": ["-std=c++20"],
    "xcode_settings": { "CLANG_CXX_LANGUAGE_STANDARD": "c++20", "CLANG_CXX_LIBRARY": "libc++" },
    "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++20"] } }
  }]
}
