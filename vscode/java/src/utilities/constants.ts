// Declare webpack-defined globals
declare const __EXTENSION_NAME__: string;
declare const __EXTENSION_PUBLISHER__: string;
declare const __EXTENSION_VERSION__: string;
declare const __BUILD_GIT_SHA__: string;
declare const __BUILD_GIT_SHA_SHORT__: string;
declare const __BUILD_TIMESTAMP__: string;
declare const __EXTENSION_AUTHOR__: string;
declare const __EXTENSION_DISPLAY_NAME__: string;

// Build-time constants injected by webpack DefinePlugin
export const EXTENSION_NAME = __EXTENSION_NAME__;
export const EXTENSION_AUTHOR = __EXTENSION_AUTHOR__;
export const EXTENSION_PUBLISHER = __EXTENSION_PUBLISHER__;
export const EXTENSION_VERSION = __EXTENSION_VERSION__;
export const EXTENSION_DISPLAY_NAME = __EXTENSION_DISPLAY_NAME__;
export const BUILD_GIT_SHA = __BUILD_GIT_SHA__;
export const BUILD_GIT_SHA_SHORT = __BUILD_GIT_SHA_SHORT__;
export const BUILD_TIMESTAMP = __BUILD_TIMESTAMP__;

// Convenience: Full extension ID (publisher.name)
export const EXTENSION_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`;

// Convenience: Version with git info for debugging
export const BUILD_INFO = `v${EXTENSION_VERSION} ${BUILD_GIT_SHA} (${BUILD_TIMESTAMP})`;
