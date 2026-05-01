# Changelog

All notable changes to the "konveyor-java" extension will be documented in this file.



## [0.4.12] - 2026-05-01

### Bug Fixes

- Java extension now waits for the Java Language Server to reach Standard mode before starting the LSP proxy and provider, fixing a race condition in DevSpaces where the extension would fail to activate and require a window reload. ([#1349](https://github.com/konveyor/editor-extensions/pull/1349))


## [0.4.5] - 2026-03-06

### Bug Fixes

- Fix Unix domain socket path length limit on macOS by using /tmp instead of os.tmpdir() for IPC socket paths, preventing failures when the system temp directory path is long.


## [0.4.0] - 2026-02-19

### New Features

- Added core API version compatibility checking with language extensions. ([#1011](https://github.com/konveyor/editor-extensions/pull/1011))
- Activated language extensions based on workspace files. ([#1070](https://github.com/konveyor/editor-extensions/pull/1070))
- Added health check command for language providers. ([#1075](https://github.com/konveyor/editor-extensions/pull/1075))
- Created separate Java and JavaScript language extensions. ([#960](https://github.com/konveyor/editor-extensions/pull/960))

### Bug Fixes

- Gracefully handle provider errors when dependencies are missing. ([#1117](https://github.com/konveyor/editor-extensions/pull/1117))
- Improved Windows compatibility across extensions. ([#983](https://github.com/konveyor/editor-extensions/pull/983))


