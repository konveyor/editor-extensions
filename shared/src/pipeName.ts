/** Safe IPC path length limits per platform (bytes including null terminator minus 1). */
const SAFE_IPC_PATH_LENGTHS: Record<string, number> = {
  darwin: 103,
  linux: 107,
};

let counter = 0;

/**
 * Generate a unique random suffix for socket filenames.
 * Uses timestamp + counter + Math.random for uniqueness without requiring node:crypto.
 */
function randomSuffix(): string {
  const time = Date.now().toString(36);
  const count = (counter++).toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${time}-${count}-${rand}`;
}

/**
 * Generate a Unix domain socket path that fits within OS path length limits.
 *
 * On macOS, `sun_path` in `sockaddr_un` is 104 bytes (103 usable characters).
 * The upstream `vscode-jsonrpc` `generateRandomPipeName()` uses `os.tmpdir()`
 * which on macOS resolves to `/var/folders/…` (~48 chars), producing paths that
 * are exactly at or over the 103-char limit.
 *
 * This function uses `/tmp` directly (4 chars) with a shorter random suffix,
 * producing paths well under the limit.
 *
 * On Windows, named pipes (`\\.\pipe\…`) have no practical length limit.
 *
 * @param prefix - Short identifier for the socket name (e.g. extension name).
 *                 Keep short to stay under the 103-char macOS limit.
 */
export function generateSafePipeName(prefix: string): string {
  if (process.platform === "win32") {
    // Windows named pipes use \\.\pipe\ namespace and have no practical length limit.
    return `\\\\.\\pipe\\${prefix}-${randomSuffix()}`;
  }

  const result = `/tmp/${prefix}-${randomSuffix()}.sock`;

  const limit = SAFE_IPC_PATH_LENGTHS[process.platform];
  if (limit !== undefined && result.length > limit) {
    throw new Error(
      `Generated IPC socket path "${result}" (${result.length} chars) exceeds ` +
        `the ${process.platform} limit of ${limit} characters.`,
    );
  }

  return result;
}
