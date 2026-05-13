# Changelog

All notable changes to the "konveyor-javascript" extension will be documented in this file.

## [0.4.0] - 2026-02-19

### New Features

- Added core API version compatibility checking with language extensions. ([#1011](https://github.com/konveyor/editor-extensions/pull/1011))
- Activated language extensions based on workspace files. ([#1070](https://github.com/konveyor/editor-extensions/pull/1070))
- Created separate Java and JavaScript language extensions. ([#960](https://github.com/konveyor/editor-extensions/pull/960))

### Bug Fixes

- Added helper methods to the proxy for vscode object conversion. ([#1004](https://github.com/konveyor/editor-extensions/pull/1004))
- Fixed JavaScript extension activation to trigger indexing and wait for completion. ([#1019](https://github.com/konveyor/editor-extensions/pull/1019))
- Added documentSymbol search and fixed workspace/symbol response. ([#1038](https://github.com/konveyor/editor-extensions/pull/1038))
- Gracefully handle provider errors when dependencies are missing. ([#1117](https://github.com/konveyor/editor-extensions/pull/1117))
- Improved Windows compatibility across extensions. ([#983](https://github.com/konveyor/editor-extensions/pull/983))
- Fixed JavaScript extension to pass config correctly to provider. ([#999](https://github.com/konveyor/editor-extensions/pull/999))


