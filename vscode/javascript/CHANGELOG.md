# Changelog

All notable changes to the "konveyor-javascript" extension will be documented in this file.

## [Unreleased]

### Added

- Initial release of the Konveyor JavaScript extension
- JavaScript and TypeScript language support for Konveyor migration and modernization analysis
- Support for JavaScript, TypeScript, JSX, and TSX files
- Generic external provider integration for symbol resolution and code analysis
- Automatic activation on JavaScript/TypeScript projects (package.json, tsconfig.json, jsconfig.json)
- Core API version compatibility checking with Konveyor core extension
- Workspace file-based activation for improved project detection
- Document symbol search for accurate code navigation

### Fixed

- Configuration passing to the language provider
- Helper methods for converting VS Code objects to provider format
- Use VS Code's language client code converter for better compatibility
- Activation now properly triggers indexing and waits for completion
- Windows compatibility for cross-platform support
