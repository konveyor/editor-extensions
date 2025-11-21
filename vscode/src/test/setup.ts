// Test setup file - mocks webpack-defined globals
// This file is loaded before all tests run

// Mock webpack DefinePlugin globals for test environment
(global as any).__EXTENSION_NAME__ = "konveyor";
(global as any).__EXTENSION_AUTHOR__ = "Konveyor";
(global as any).__EXTENSION_PUBLISHER__ = "konveyor";
(global as any).__EXTENSION_VERSION__ = "0.0.0-test";
(global as any).__EXTENSION_DISPLAY_NAME__ = "Konveyor Extension for VSCode";
(global as any).__EXTENSION_SHORT_NAME__ = "Konveyor";
(global as any).__BUILD_GIT_SHA__ = "test-sha";
(global as any).__BUILD_GIT_SHA_SHORT__ = "test";
(global as any).__BUILD_TIMESTAMP__ = new Date().toISOString();
