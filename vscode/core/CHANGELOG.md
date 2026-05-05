# Changelog

All notable changes to the "konveyor.konveyor-core" extension will be documented in this file.










## [0.4.14] - 2026-05-05

### Bug Fixes

- Fix analysis being blocked after accepting a solution and reverting the file. When the batch review completed (all files accepted/rejected/continued), checkBatchReviewComplete only cleared pendingBatchReview but did not reset the workflow state flags (isFetchingSolution, solutionState, isWaitingForUserInteraction, isProcessingQueuedMessages). This left the extension in a broken state where analysis could not run because it thought a resolution was still in progress. Now checkBatchReviewComplete fully resets all workflow flags when the batch is done, and also cleans up stale workflow resources (queue manager, pending interactions, modified files cache).
- Replaced hardcoded "Konveyor Hub" references in configuration UI with dynamic branding to support downstream rebranding.


## [0.4.12] - 2026-05-01

### Bug Fixes

- Add enabled property to LLM proxy client. ([#1374](https://github.com/konveyor/editor-extensions/pull/1374))
- Fix continue button remaining disabled after closing editor tab with active code lenses. When the user opens a solution in review mode (with accept/reject code lenses) and closes the editor tab without accepting or rejecting, the activeDecorators state was not cleaned up. This left the batch review UI in a stuck state where the continue button stayed disabled. Added an onDidCloseTextDocument listener to VerticalDiffManager that clears diff state when the editor tab is closed, treating it as a reject/discard. Also fixes a related issue where the closed file retained patched content in VS Code's in-memory buffer by reverting the file to its on-disk state, and resets the webview review UI so users can re-open the review.
- Fix solution server not receiving user's in-place edits when accepting a solution. Previously, when a user edited the LLM-suggested fix directly in the editor before clicking Accept, the solution server received the original LLM-generated content instead of the user's modified version. The fix now reads the file from disk at accept time, capturing any edits made between fix generation and acceptance.


## [0.4.11] - 2026-04-30

### Bug Fixes

- Hub-synced profiles are now stored in a dedicated .konveyor/hub-profiles/ directory, separate from user-managed profiles in .konveyor/profiles/. When Hub profile sync is disabled, the hub profiles directory is automatically cleaned up, restoring local profile management without requiring manual directory deletion. ([#1185](https://github.com/konveyor/editor-extensions/pull/1185))


## [0.4.9] - 2026-03-26

### Bug Fixes

- Fixed duplicate profile name exceeding the 24-character limit by truncating the base name before appending the copy suffix. ([#1286](https://github.com/konveyor/editor-extensions/pull/1286))


## [0.4.7] - 2026-03-11

### Bug Fixes

- Fixed an issue caused by empty new lines in diffs when reviewing a proposed solution.
- Fixed Hub LLM proxy race condition, stream errors from leaked cacheKey option, TLS propagation to proxy models, and no-auth Hub support.


## [0.4.5] - 2026-03-06

### Enhancements

- Added network error classification and diagnostic logging for Hub API calls to help triage connection issues in restricted environments. ([#1300](https://github.com/konveyor/editor-extensions/pull/1300))

### Bug Fixes

- Fixed CA_BUNDLE and ALLOW_INSECURE not reaching Google GenAI provider due to webpack-bundled undici being separate from Node's built-in fetch.
- Fix Unix domain socket path length limit on macOS by using /tmp instead of os.tmpdir() for IPC socket paths, preventing failures when the system temp directory path is long.


## [0.4.3] - 2026-03-04

### Bug Fixes

- Fix incident status not updating after token refresh by preserving solution server session state (clientId) across token refreshes. ([#1273](https://github.com/konveyor/editor-extensions/pull/1273))


## [0.4.1] - 2026-02-26

### Enhancements

- Graceful degraded state when no workspace is open or no language providers are registered, with guided welcome content in the sidebar to help users open a folder, install language extensions, or get started with analysis. ([#1263](https://github.com/konveyor/editor-extensions/pull/1263))

### Bug Fixes

- Fixed misleading http:// placeholder in Hub URL field that led users to use insecure URLs for remote Hubs, causing connection failures. Now defaults to https:// and warns when http:// is used with non-localhost URLs. ([#1247](https://github.com/konveyor/editor-extensions/pull/1247))
- Do not bypass SSL globally in solution server client.  Uses existing custom fetch function that we use for model provider connection. Uses the existing mock server infrastructure with self-signed certificates to test SSL bypass behavior. ([#1258](https://github.com/konveyor/editor-extensions/pull/1258))
- Fixed CA_BUNDLE and ALLOW_INSECURE settings being ignored for the Google GenAI provider by configuring the global fetch dispatcher with custom TLS certificates.


## [0.4.0] - 2026-02-19

### New Features

- Added core API version compatibility checking with language extensions. ([#1011](https://github.com/konveyor/editor-extensions/pull/1011))
- Added multi-language support so agent is no longer hardcoded to Java. ([#1013](https://github.com/konveyor/editor-extensions/pull/1013))
- Added analysis progress display with rule IDs. ([#1022](https://github.com/konveyor/editor-extensions/pull/1022))
- Added HTTP protocol configuration for solution server. ([#1034](https://github.com/konveyor/editor-extensions/pull/1034))
- Added Hub settings form for centralized Konveyor Hub configuration. ([#1035](https://github.com/konveyor/editor-extensions/pull/1035))
- Added hub connection manager for improved connectivity handling. ([#1072](https://github.com/konveyor/editor-extensions/pull/1072))
- Added profile sync for centralized configuration management. ([#1079](https://github.com/konveyor/editor-extensions/pull/1079))
- Added RPC-based progress notifications for better analysis feedback. ([#1087](https://github.com/konveyor/editor-extensions/pull/1087))
- Added violation-specific search on open details command. ([#1174](https://github.com/konveyor/editor-extensions/pull/1174))
- Added welcome view with open analysis panel and manage profiles actions. ([#1192](https://github.com/konveyor/editor-extensions/pull/1192))
- Added support for setting hub configuration via environment variables. ([#1203](https://github.com/konveyor/editor-extensions/pull/1203))
- Added adaptive polling for solution server connectivity. ([#735](https://github.com/konveyor/editor-extensions/pull/735))
- Improved file suggestions UX. ([#874](https://github.com/konveyor/editor-extensions/pull/874))
- Handle and display LLM error messages from workflow. ([#948](https://github.com/konveyor/editor-extensions/pull/948))
- Surface solution server interactions in the UI. ([#965](https://github.com/konveyor/editor-extensions/pull/965))
- Added extension API for language provider registration. ([#970](https://github.com/konveyor/editor-extensions/pull/970))
- Added in-tree analysis configuration profiles support. ([#986](https://github.com/konveyor/editor-extensions/pull/986))
- Added batch review system and state management improvements. ([#990](https://github.com/konveyor/editor-extensions/pull/990))
- Added support for opening VS Code in web environment.

### Enhancements

- Removed onDidChangeData message handler and duplicate broadcast functions. ([#1073](https://github.com/konveyor/editor-extensions/pull/1073))
- Added fallback to recent successful workflow run when HEAD commit fails. ([#1078](https://github.com/konveyor/editor-extensions/pull/1078))
- Added MessageTypes constants to eliminate string literal sprawl. ([#1114](https://github.com/konveyor/editor-extensions/pull/1114))
- Added sourcemaps for agentic debugging. ([#876](https://github.com/konveyor/editor-extensions/pull/876))
- Improved logging throughout the extension. ([#877](https://github.com/konveyor/editor-extensions/pull/877))
- Removed deprecated package.json commands. ([#885](https://github.com/konveyor/editor-extensions/pull/885))
- Cleaned up unused memfs/localChanges/diffViewType configuration. ([#887](https://github.com/konveyor/editor-extensions/pull/887))
- Moved core extension to vscode/core/ directory structure. ([#945](https://github.com/konveyor/editor-extensions/pull/945))

### Bug Fixes

- Fixed VS Code ESM loader error. ([#1001](https://github.com/konveyor/editor-extensions/pull/1001))
- Allow scheduled analysis cancellation. ([#1002](https://github.com/konveyor/editor-extensions/pull/1002))
- Reverted breaking scheduled check. ([#1007](https://github.com/konveyor/editor-extensions/pull/1007))
- Fixed settings.json config update error handling. ([#1024](https://github.com/konveyor/editor-extensions/pull/1024))
- Removed tooltip for config button. ([#1025](https://github.com/konveyor/editor-extensions/pull/1025))
- Added error handling for RPC connection failures in fireServerStateChange. ([#1048](https://github.com/konveyor/editor-extensions/pull/1048))
- Reduced diff noise from line endings and whitespace changes. ([#1077](https://github.com/konveyor/editor-extensions/pull/1077))
- Fixed socket ETIMEDOUT connection errors. ([#1085](https://github.com/konveyor/editor-extensions/pull/1085))
- Fixed batch review state stuck after apply all. ([#1092](https://github.com/konveyor/editor-extensions/pull/1092))
- Fixed analyzer profile bundle filtering out all files. ([#1111](https://github.com/konveyor/editor-extensions/pull/1111))
- Enabled skip SSL toggle even when auth is disabled. ([#1121](https://github.com/konveyor/editor-extensions/pull/1121))
- Fixed catch-all causing store reset in devspaces. ([#1170](https://github.com/konveyor/editor-extensions/pull/1170))
- Added character limit for profile names. ([#1178](https://github.com/konveyor/editor-extensions/pull/1178))
- Fixed profile sync label selector error. ([#1180](https://github.com/konveyor/editor-extensions/pull/1180))
- Ensured profiles are reloaded after enabling sync. ([#1187](https://github.com/konveyor/editor-extensions/pull/1187))
- Fixed analysis to ignore files that git ignores. ([#1188](https://github.com/konveyor/editor-extensions/pull/1188))
- Added file input for uploading custom rules in web environments. ([#1189](https://github.com/konveyor/editor-extensions/pull/1189))
- Removed trailing slash in hub config form. ([#1196](https://github.com/konveyor/editor-extensions/pull/1196))
- Fixed analysis to only pass top-level ignore directories. ([#1197](https://github.com/konveyor/editor-extensions/pull/1197))
- Fixed hub configuration persistence. ([#1200](https://github.com/konveyor/editor-extensions/pull/1200))
- Fixed provider notification when a file changes. ([#1202](https://github.com/konveyor/editor-extensions/pull/1202))
- Do not run auto analysis on save if analysis pre-reqs are not met. ([#1206](https://github.com/konveyor/editor-extensions/pull/1206))
- Fixed config errors updating on profile mutation. ([#1208](https://github.com/konveyor/editor-extensions/pull/1208))
- Improved handling of centralized config auth failures. ([#1212](https://github.com/konveyor/editor-extensions/pull/1212))
- Avoid opening default model provider config when LLM proxy is available. ([#1214](https://github.com/konveyor/editor-extensions/pull/1214))
- Fixed environment variable overrides to only apply when explicitly set. ([#1218](https://github.com/konveyor/editor-extensions/pull/1218))
- Improved useDefaultRules logic. ([#1219](https://github.com/konveyor/editor-extensions/pull/1219))
- Fixed notify changes by moving it out of conditional block. ([#1222](https://github.com/konveyor/editor-extensions/pull/1222))
- Refactored profile deletion dialog logic. ([#743](https://github.com/konveyor/editor-extensions/pull/743))
- Improved toolbar header responsiveness. ([#837](https://github.com/konveyor/editor-extensions/pull/837))
- Fixed duplicate solution server auth config error. ([#847](https://github.com/konveyor/editor-extensions/pull/847))
- Fixed output parsing for analysis. ([#854](https://github.com/konveyor/editor-extensions/pull/854))
- Fixed handling of max_tokens in Bedrock responses. ([#855](https://github.com/konveyor/editor-extensions/pull/855))
- Fixed logger transports update when log level changes. ([#860](https://github.com/konveyor/editor-extensions/pull/860))
- Fixed duplicate ADD_PROFILE message when duplicating profiles. ([#863](https://github.com/konveyor/editor-extensions/pull/863))
- Fixed broken CSS overrides for SVG icons. ([#868](https://github.com/konveyor/editor-extensions/pull/868))
- Made solution server client aware of refresh windows. ([#871](https://github.com/konveyor/editor-extensions/pull/871))
- Fixed workflowManager to update model provider when model changes. ([#886](https://github.com/konveyor/editor-extensions/pull/886))
- Added warnings about AI capabilities and limitations. ([#889](https://github.com/konveyor/editor-extensions/pull/889))
- Fixed duplicate Analysis panel issue by implementing static panel tracking. ([#895](https://github.com/konveyor/editor-extensions/pull/895))
- Fixed custom rule changes handling. ([#906](https://github.com/konveyor/editor-extensions/pull/906))
- Improved logging and error display when Java extension encounters issues. ([#911](https://github.com/konveyor/editor-extensions/pull/911))
- Fixed non-agent mode. ([#921](https://github.com/konveyor/editor-extensions/pull/921))
- Allow user to reject changes by default without auto accept on save. ([#932](https://github.com/konveyor/editor-extensions/pull/932))
- Fixed debugger after path change. ([#952](https://github.com/konveyor/editor-extensions/pull/952))
- Disable manual analysis if analysis is already scheduled. ([#964](https://github.com/konveyor/editor-extensions/pull/964))
- Ensure analysis scheduled state is always reset. ([#973](https://github.com/konveyor/editor-extensions/pull/973))
- Improved Windows compatibility across extensions. ([#983](https://github.com/konveyor/editor-extensions/pull/983))
- Fixed provider check race condition on server start. ([#988](https://github.com/konveyor/editor-extensions/pull/988))
- Fix analyzer binary download to track version metadata for outdated binary detection and provide actionable error messages in network-restricted environments.


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
