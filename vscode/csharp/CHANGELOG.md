# Changelog

All notable changes to the "konveyor-csharp" extension will be documented in this file.


## [0.8.0] - 2026-09-24

### Bug Fixes

- Publish C# as platform-specific packages with bundled analyzers to stay within the Open VSX size limit. Validate all package sizes before publication. ([#1494](https://github.com/konveyor/editor-extensions/pull/1494))
- Fixed packaging and launching of the C# analyzer provider after it moved to a self-contained .NET publish directory with a CSharpProvider entrypoint.
- Updated bundled analyzer components and rulesets to v0.11.0-beta.1, fixing stable release packaging with the current C# provider runtime.


## [0.6.0] - 2026-07-03

### Bug Fixes

- Added version compatibility check at activation time for Go and C# provider extensions to prevent silent failures when running with an incompatible core extension.
- Fix Unix domain socket path length limit on macOS by using /tmp instead of os.tmpdir() for IPC socket paths, preventing failures when the system temp directory path is long.

## [0.4.0] - 2026-02-19

### New Features

- Added C# language extension support. ([#1124](https://github.com/konveyor/editor-extensions/pull/1124))
