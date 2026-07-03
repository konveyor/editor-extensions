# Changelog

All notable changes to the "konveyor" extension pack will be documented in this file.

## [0.6.0] - 2026-07-03

### Enhancements

- Decouple all model-bound prompt templates into a governed, version-controlled @editor-extensions/prompts package (ISO 42001 A.5.2): Handlebars templates with a semver manifest, byte-exact parity + deterministic semantic-regression tests, a CI validation pipeline, CODEOWNERS review on prompts/, and PROMPT_GOVERNANCE.md. ([#0000](https://github.com/konveyor/editor-extensions/pull/0000))
- Add a minimal smoke E2E flow and decouple heavy base tests from tiered runs. ([#0000](https://github.com/konveyor/editor-extensions/pull/0000))
- Graceful degraded state when no workspace is open or no language providers are registered, with guided welcome content in the sidebar to help users open a folder, install language extensions, or get started with analysis. ([#1263](https://github.com/konveyor/editor-extensions/pull/1263))
- Added network error classification and diagnostic logging for Hub API calls to help triage connection issues in restricted environments. ([#1300](https://github.com/konveyor/editor-extensions/pull/1300))
- Redesign ToolMessage component with compact inline indicators, collapsible tool groups, and improved status styling for better readability during multi-tool agent workflows. ([#1394](https://github.com/konveyor/editor-extensions/pull/1394))
- Add OIDC authentication (auth code + PKCE, device flow fallback) and a Hub connection status panel showing live session state, sign in/out controls, token expiry, and per-feature connection indicators. ([#1419](https://github.com/konveyor/editor-extensions/pull/1419))
- Each language extension now bundles and supplies its own stable rulesets instead of all rulesets being bundled in the core extension. ([#1440](https://github.com/konveyor/editor-extensions/pull/1440))
- Replace hand-rolled OIDC implementation with oauth4webapi for spec-compliant discovery, token exchange, refresh, and end-session. Sign-out now properly invalidates the server-side OIDC session. ([#1453](https://github.com/konveyor/editor-extensions/pull/1453))
- Dynamically discover available target and source labels from bundled rulesets at runtime instead of using hardcoded lists, fixing missing Spring and other migration targets in the profile editor.
- Surface analyzer process errors to the extension output channel by promoting stderr logging from debug to warn level, tailing analyzer.log for ERROR/FATAL lines during startup, and adding progress feedback with early abort detection during pipe connection retries.

### Bug Fixes

- When an automatic analysis kicks off due to file save, it appears that we can still stop the analysis server which leaves the extension in an unrecoverable state. This change prevents stopping the analysis server during running or scheduled analysis. ([#0000](https://github.com/konveyor/editor-extensions/pull/0000))
- Hub-synced profiles are now stored in a dedicated .konveyor/hub-profiles/ directory, separate from user-managed profiles in .konveyor/profiles/. When Hub profile sync is disabled, the hub profiles directory is automatically cleaned up, restoring local profile management without requiring manual directory deletion. ([#1185](https://github.com/konveyor/editor-extensions/pull/1185))
- Do not bypass SSL globally in solution server client. Uses existing custom fetch function that we use for model provider connection. Uses the existing mock server infrastructure with self-signed certificates to test SSL bypass behavior. ([#1258](https://github.com/konveyor/editor-extensions/pull/1258))
- Fix incident status not updating after token refresh by preserving solution server session state (clientId) across token refreshes. ([#1273](https://github.com/konveyor/editor-extensions/pull/1273))
- Fixed duplicate profile name exceeding the 24-character limit by truncating the base name before appending the copy suffix. ([#1286](https://github.com/konveyor/editor-extensions/pull/1286))
- ignore files outside workspace in analysis trigger. ([#1343](https://github.com/konveyor/editor-extensions/pull/1343))
- Java extension now waits for the Java Language Server to reach Standard mode before starting the LSP proxy and provider, fixing a race condition in DevSpaces where the extension would fail to activate and require a window reload. ([#1349](https://github.com/konveyor/editor-extensions/pull/1349))
- Add enabled property to LLM proxy client. ([#1374](https://github.com/konveyor/editor-extensions/pull/1374))
- Upgrade no-response logging from silly to warn in agentic workflow nodes so silent LLM failures are visible in normal log output. ([#1391](https://github.com/konveyor/editor-extensions/pull/1391))
- Add configurable timeout (default 5 minutes) to LLM requests in streamOrInvoke to prevent indefinite hanging when the model provider is misconfigured or unreachable. Upgrade no-response logging from silly to warn with actionable error messages. ([#1392](https://github.com/konveyor/editor-extensions/pull/1392))
- Fix file showing patched content after closing review editor tab without accepting. Use tabGroups.onDidChangeTabs to restore the clean on-disk buffer via WorkspaceEdit instead of the unreliable onDidCloseTextDocument + revert approach. ([#1410](https://github.com/konveyor/editor-extensions/pull/1410))
- Honor the NO_PROXY environment variable when deciding whether to route Hub and GenAI provider connections through HTTP_PROXY/HTTPS_PROXY. Targets matching NO_PROXY (including loopback addresses such as 127.0.0.1) now bypass the proxy as expected. ([#1415](https://github.com/konveyor/editor-extensions/pull/1415))
- Agent-mode workflow no longer hits the LangGraph recursion limit on small incident sets. Raises the analysis-fix recursion floor and breaks a router self-loop that ran when no additional information accumulated. ([#1418](https://github.com/konveyor/editor-extensions/pull/1418))
- Demo-mode LLM response cache now resolves on Windows. Workspace-relative paths used in cache keys and prompt content are normalized to POSIX separators, and line endings are normalized when deriving cache keys, so a cache recorded on Linux/macOS (LF) is found on a Windows checkout (CRLF). ([#1425](https://github.com/konveyor/editor-extensions/pull/1425))
- Fixed Go analysis on Windows by correcting URI handling in the LSP proxy: file URIs now use unencoded drive-letter colons (c:/ instead of c%3A/) so that the go-external-provider can correctly match reference locations against the workspace folder and produce analysis violations. ([#1427](https://github.com/konveyor/editor-extensions/pull/1427))
- Update the e2e infrastructure setup, hub seeding script, and solution-server test client to authenticate against the hub's built-in IdP via POST /hub/auth/tokens (Basic auth) after the operator removed keycloak in favor of a hub-managed OIDC implementation. ([#1436](https://github.com/konveyor/editor-extensions/pull/1436))
- Show absolute date for token expiry over 24 hours instead of unrealistic hour count (e.g. "on Jun 17, 2036" instead of "in 87599h 59m"). ([#1451](https://github.com/konveyor/editor-extensions/pull/1451))
- Added version compatibility check at activation time for Go and C# provider extensions to prevent silent failures when running with an incompatible core extension.
- Added ANALYZER_FALLBACK_BASE_URL environment variable to override fallback asset download URLs for air-gapped environments.
- Fixed E2E tests checking out main instead of the release branch during patch releases, causing test-code/extension-code version mismatches.
- Fixed an issue caused by empty new lines in diffs when reviewing a proposed solution.
- Fixed CA_BUNDLE and ALLOW_INSECURE not reaching Google GenAI provider due to webpack-bundled undici being separate from Node's built-in fetch.
- Fixed CA_BUNDLE and ALLOW_INSECURE settings being ignored for the Google GenAI provider by configuring the global fetch dispatcher with custom TLS certificates.
- Fixed Hub LLM proxy race condition, stream errors from leaked cacheKey option, TLS propagation to proxy models, and no-auth Hub support.
- Fixed provider address format for Windows named pipes in Go and C# extensions to use the passthrough:unix:// prefix required by analyzer-lsp.
- Fix continue button remaining disabled after closing editor tab with active code lenses. When the user opens a solution in review mode (with accept/reject code lenses) and closes the editor tab without accepting or rejecting, the activeDecorators state was not cleaned up. This left the batch review UI in a stuck state where the continue button stayed disabled. Added an onDidCloseTextDocument listener to VerticalDiffManager that clears diff state when the editor tab is closed, treating it as a reject/discard. Also fixes a related issue where the closed file retained patched content in VS Code's in-memory buffer by reverting the file to its on-disk state, and resets the webview review UI so users can re-open the review.
- Fix Unix domain socket path length limit on macOS by using /tmp instead of os.tmpdir() for IPC socket paths, preventing failures when the system temp directory path is long.
- Fix solution server not receiving user's in-place edits when accepting a solution. Previously, when a user edited the LLM-suggested fix directly in the editor before clicking Accept, the solution server received the original LLM-generated content instead of the user's modified version. The fix now reads the file from disk at accept time, capturing any edits made between fix generation and acceptance.
- Fix analysis being blocked after accepting a solution and reverting the file. When the batch review completed (all files accepted/rejected/continued), checkBatchReviewComplete only cleared pendingBatchReview but did not reset the workflow state flags (isFetchingSolution, solutionState, isWaitingForUserInteraction, isProcessingQueuedMessages). This left the extension in a broken state where analysis could not run because it thought a resolution was still in progress. Now checkBatchReviewComplete fully resets all workflow flags when the batch is done, and also cleans up stale workflow resources (queue manager, pending interactions, modified files cache).
- Replaced hardcoded "Konveyor Hub" references in configuration UI with dynamic branding to support downstream rebranding.

## [0.4.0] - 2026-02-19

### New Features

- Added core API version compatibility checking with language extensions. ([#1011](https://github.com/konveyor/editor-extensions/pull/1011))
- Added multi-language support so agent is no longer hardcoded to Java. ([#1013](https://github.com/konveyor/editor-extensions/pull/1013))
- Added analysis progress display with rule IDs. ([#1022](https://github.com/konveyor/editor-extensions/pull/1022))
- Added HTTP protocol configuration for solution server. ([#1034](https://github.com/konveyor/editor-extensions/pull/1034))
- Added Hub settings form for centralized Konveyor Hub configuration. ([#1035](https://github.com/konveyor/editor-extensions/pull/1035))
- Switched Go extension to use document/symbol instead of workspace/symbol. ([#1056](https://github.com/konveyor/editor-extensions/pull/1056))
- Activated language extensions based on workspace files. ([#1070](https://github.com/konveyor/editor-extensions/pull/1070))
- Added hub connection manager for improved connectivity handling. ([#1072](https://github.com/konveyor/editor-extensions/pull/1072))
- Added health check command for language providers. ([#1075](https://github.com/konveyor/editor-extensions/pull/1075))
- Added profile sync for centralized configuration management. ([#1079](https://github.com/konveyor/editor-extensions/pull/1079))
- Added RPC-based progress notifications for better analysis feedback. ([#1087](https://github.com/konveyor/editor-extensions/pull/1087))
- Added C# language extension support. ([#1124](https://github.com/konveyor/editor-extensions/pull/1124))
- Added violation-specific search on open details command. ([#1174](https://github.com/konveyor/editor-extensions/pull/1174))
- Added welcome view with open analysis panel and manage profiles actions. ([#1192](https://github.com/konveyor/editor-extensions/pull/1192))
- Added support for setting hub configuration via environment variables. ([#1203](https://github.com/konveyor/editor-extensions/pull/1203))
- Added adaptive polling for solution server connectivity. ([#735](https://github.com/konveyor/editor-extensions/pull/735))
- Improved file suggestions UX. ([#874](https://github.com/konveyor/editor-extensions/pull/874))
- Handle and display LLM error messages from workflow. ([#948](https://github.com/konveyor/editor-extensions/pull/948))
- Created separate Java and JavaScript language extensions. ([#960](https://github.com/konveyor/editor-extensions/pull/960))
- Surface solution server interactions in the UI. ([#965](https://github.com/konveyor/editor-extensions/pull/965))
- Added extension API for language provider registration. ([#970](https://github.com/konveyor/editor-extensions/pull/970))
- Added Go language extension support. ([#976](https://github.com/konveyor/editor-extensions/pull/976))
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
- Added helper methods to the proxy for vscode object conversion. ([#1004](https://github.com/konveyor/editor-extensions/pull/1004))
- Reverted breaking scheduled check. ([#1007](https://github.com/konveyor/editor-extensions/pull/1007))
- Fixed JavaScript extension activation to trigger indexing and wait for completion. ([#1019](https://github.com/konveyor/editor-extensions/pull/1019))
- Fixed settings.json config update error handling. ([#1024](https://github.com/konveyor/editor-extensions/pull/1024))
- Removed tooltip for config button. ([#1025](https://github.com/konveyor/editor-extensions/pull/1025))
- Added documentSymbol search and fixed workspace/symbol response. ([#1038](https://github.com/konveyor/editor-extensions/pull/1038))
- Added error handling for RPC connection failures in fireServerStateChange. ([#1048](https://github.com/konveyor/editor-extensions/pull/1048))
- Reduced diff noise from line endings and whitespace changes. ([#1077](https://github.com/konveyor/editor-extensions/pull/1077))
- Fixed socket ETIMEDOUT connection errors. ([#1085](https://github.com/konveyor/editor-extensions/pull/1085))
- Fixed batch review state stuck after apply all. ([#1092](https://github.com/konveyor/editor-extensions/pull/1092))
- Fixed analyzer profile bundle filtering out all files. ([#1111](https://github.com/konveyor/editor-extensions/pull/1111))
- Gracefully handle provider errors when dependencies are missing. ([#1117](https://github.com/konveyor/editor-extensions/pull/1117))
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
- Fixed JavaScript extension to pass config correctly to provider. ([#999](https://github.com/konveyor/editor-extensions/pull/999))
- Fix analyzer binary download to track version metadata for outdated binary detection and provide actionable error messages in network-restricted environments.
