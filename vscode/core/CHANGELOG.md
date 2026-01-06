# Changelog

All notable changes to the "konveyor.konveyor" extension will be documented in this file.

## [Unreleased]

### Added

- Profile sync for centralized configuration management
- RPC-based progress notifications for better analysis feedback
- Hub connection manager for improved connectivity handling
- Core API version compatibility checking with language extensions
- Batch review system and state management improvements
- Hub settings form for centralized Konveyor Hub configuration
- Analysis progress display with rule IDs
- Multi-language support - agent no longer hardcoded to Java
- Surface solution server interactions in the UI
- Handle and display LLM error messages from workflow
- In-tree analysis configuration profiles support
- Extension API for language provider registration
- Adaptive polling for solution server connectivity
- Improved file suggestions UX
- Support for opening VS Code in web environment

### Fixed

- Socket ETIMEDOUT connection errors
- settings.json config update error handling
- Allow scheduled analysis cancellation
- Provider check to fix race condition on server start
- Windows compatibility improvements
- Ensure analysis scheduled state is always reset
- Disable manual analysis if analysis is already scheduled
- Warnings about AI capabilities and limitations
- Solution server client awareness of refresh windows
- Custom rule changes handling
- Duplicate ADD_PROFILE message when duplicating profiles
- Handle max_tokens in Bedrock responses
- Broken CSS overrides for SVG icons
- Toolbar header responsiveness
- Output parsing for analysis fix
- Remove tooltip for config button

### Changed

- Moved core extension to `vscode/core/` directory structure
- Improved logging throughout the extension
- Cleanup unused memfs/localChanges/diffViewType configuration
- Remove deprecated package.json commands
- Add sourcemaps for agentic debugging

## [0.2.0] - 2025-09-30

### Added

- Implement functional CodeActionProvider with Continue
- Vscode walkthrough -> Webview drawer walkthrough
- Add profile management panel with duplicate profile functionality
- Do kai things in IDE directly
- Add createbleMultiSelectField component for managing src/tgt values
- Introduce a shared library for agentic workflows
- Move analysis fix into an agent and add planner/orchestrator/sub-agents to handle diagnostics issues
- Add dependency agent
- Add development builds
- Add solution server with authentication support
- Manage profiles UX improvements
- Allow excluding sources from diagnostics
- Show success rate in the analysis page
- Agentic flow UX improvements
- Unified logging in extension
- Hunk Selection interface improvements
- Add caching and tracing
- Skipping additional information will take you to diagnostics issues fixes instead of exiting
- Feature: debug tarball
- Support disabling generative AI
- Enhanced Diff Management with decorators
- Pull analyzer binary from package definition when not found
- Load config/command namespace from package name
- Improve solution server connectivity handling and error messaging
- Remove obsoleted variables from config
- Branding system for downstream support
- Brand agnostic path change

### Fixed

- Fix initial user messages timestamp unwanted change
- Pass label selector via initialize()
- Fix copy-dist to put the jdtls bundle in the right place
- Update contributes.javaExtensions
- Make build files reload workspace configuration
- Stop upload failures caused by duplicate names
- Fix model provider configuration
- Make agent/model errors louder
- Fix bad state in analysis issue fix
- Fix windows file paths
- Open provider config check to more provider types
- Don't rebuild shared package during debugging
- Actually fail activation by throwing error
- Remove AWS_DEFAULT_REGION env validation
- Respect analyze on save config setting
- Add scrollbar to walkthrough drawer when terminal is open
- Fix label selector logic to properly AND sources with targets
- Surface underlying issues with Java extension
- Update success rate more often
- Do not show ViolationsCount when analyzing
- Reduce bot noise
- Issue tree view needs enhanced incidents
- Fix: Search fails to display existing analysis incidents
- Remove duplicate selection state for interaction messages
- ScrollToBottom on interaction event
- Missing css variables for diff view
- Fix isReadonly for incident inside resolution page
- Fix race conditions with the queue
- Refactor model healthcheck for better cohesion with provider config file
- Fix type errors in dev spaces
- Do not track file changes/saves if isUriIgnored
- Fix duplicate no profile selected alert
- Accept files in agent mode
- Make sure extension logs are added to debug archive
- Allow self-signed certs in model provider connection and allow insecure flag
- Fix auto-analysis trigger and config key mismatch
- Hide agent button when genAI disabled
- Fix delayed profile deletion by ensuring immediate UI updates
- Analyzer and genai config fixes
- Incorrect nesting of settings no longer requires auth to be enabled for insecure TLS
- Fix profile multi-select + config order
- Retry logic for connection attempts with and without trailing slash
- Fix success rate display when server returns array format
- Do not load saved analysis results in startup
- Manage profiles form validation fix
- Move isWaitingForUserInteraction to shared state
- Fix configuration error notifications on extension startup
- Handle new line and empty diffs gracefully
- Handle analyzer process exit gracefully
- Handle reject solution correctly
- Update success rate metrics on accept/reject
- Improve additional info prompt and remove unused options
- Improve solution server configuration, start behavior
- Persist 'no changes' and 'quick response' messages
- Handle creds better in solution server
- Do not attempt to getServerCapabilities when disconnected
- Use the centralized runPartialAnalysis() function
- Normalize paths
- searchFiles should handle rel paths correctly
- Address light-theme color and background css token gaps
- Show config alert for failed SS connection
- Only reset localProfile when the user actually switches to a different profile
- Default to dark mode theme for label visibility
- Do not go through solution server restart when disabled
- Add full descriptions for configuration options
- REVERT "do not attempt to getServerCapabilities when disconnected"

### Tests

- Add test for fixing a single incident
- Adding SS test with custom rules
- Add filtering and Sorting Issues and Files UI tests
- LLM revert check
- Automate analysis with a custom analyzer binary
- Brand agnostic extension testing
- Fix brace-expansion CVE vulnerability
- Windows adaptations
- Adapt evaluation
- Wait for extension to initialize

### New Contributors

- [@rhuanhianc](https://github.com/rhuanhianc)
- [@jmontleon](https://github.com/jmontleon)
- [@abrugaro](https://github.com/abrugaro)
- [@feiskyer](https://github.com/feiskyer)
- [@RanWurmbrand](https://github.com/RanWurmbrand)
- [@fabianvf](https://github.com/fabianvf)

**Full Changelog**: https://github.com/konveyor/editor-extensions/compare/v0.1.0...v0.2.0

## [0.1.0] - 2025-03-12

### Added

- Use @patternfly/chatbot library for the resolutions view
- Add configurable ignores for analysis
- Add 'cursor: pointer' to `<summary/>` marker in markdown

### Fixed

- Deduplicate encountered errors in chat view
- Reclaim webview body padding, page inset
- Remove sm size to restore button alignment
- Remove unused configuration keys
- Only run partial analysis if a file was changed
- Do rpc server actions only if the server is ready
- Adding updated analyzer bundle that can handle code updates
- Simplify issue rendering
- Load the results even when no rulesets
- Adding back bundle
- Save source/target onSelectionChange
- Redirect user to analysis page at the end of the konveyor walkthrough

### Known Issues

- `.konveyorignore` is not respected by git vfs. If you see log files showing up in your diffs, use `.gitignore` for now. Make sure those log files/directories are added to your workspace's `.gitignore`.
- If vscode is closed in the middle of an analysis, the kai processes won't stop immediately. This can result in strange results from the analysis panel. Once the analysis completes, the process should close correctly. If necessary, you can kill it manually. The process should be `kai-rpc-server` or `kai_analyzer_rpc`.

**Full Changelog**: https://github.com/konveyor/editor-extensions/compare/v0.0.13...v0.1.0
