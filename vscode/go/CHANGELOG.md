# Changelog

All notable changes to the "konveyor-go" extension will be documented in this file.



## [0.4.20] - 2026-06-19

### Bug Fixes

- Fixed Go analysis on Windows by correcting URI handling in the LSP proxy: file URIs now use unencoded drive-letter colons (c:/ instead of c%3A/) so that the go-external-provider can correctly match reference locations against the workspace folder and produce analysis violations. ([#1427](https://github.com/konveyor/editor-extensions/pull/1427))


## [0.4.5] - 2026-03-06

### Bug Fixes

- Fix Unix domain socket path length limit on macOS by using /tmp instead of os.tmpdir() for IPC socket paths, preventing failures when the system temp directory path is long.


## [0.4.0] - 2026-02-19

### New Features

- Switched Go extension to use document/symbol instead of workspace/symbol. ([#1056](https://github.com/konveyor/editor-extensions/pull/1056))
- Activated language extensions based on workspace files. ([#1070](https://github.com/konveyor/editor-extensions/pull/1070))
- Added Go language extension support. ([#976](https://github.com/konveyor/editor-extensions/pull/976))

### Bug Fixes

- Gracefully handle provider errors when dependencies are missing. ([#1117](https://github.com/konveyor/editor-extensions/pull/1117))


