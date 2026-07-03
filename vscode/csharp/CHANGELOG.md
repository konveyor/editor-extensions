# Changelog

All notable changes to the "konveyor-csharp" extension will be documented in this file.

## [0.6.0] - 2026-07-03

### Bug Fixes

- Added version compatibility check at activation time for Go and C# provider extensions to prevent silent failures when running with an incompatible core extension.
- Fix Unix domain socket path length limit on macOS by using /tmp instead of os.tmpdir() for IPC socket paths, preventing failures when the system temp directory path is long.

## [0.4.0] - 2026-02-19

### New Features

- Added C# language extension support. ([#1124](https://github.com/konveyor/editor-extensions/pull/1124))
