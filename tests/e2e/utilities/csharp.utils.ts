import { execSync } from 'child_process';
import path from 'node:path';

/**
 * Verifies that required C# tools are installed and accessible.
 * Checks for .NET SDK, ilspycmd, and paket.
 */
export async function verifyCSharpTools(): Promise<void> {
  const checks: Array<{ name: string; command: string; check: () => boolean }> = [
    {
      name: '.NET SDK',
      command: 'dotnet --version',
      check: () => {
        try {
          execSync('dotnet --version', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      name: 'ilspycmd',
      command: 'ilspycmd --version',
      check: () => {
        try {
          execSync('ilspycmd --version', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      name: 'paket',
      command: 'paket --version',
      check: () => {
        try {
          execSync('paket --version', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
    },
  ];

  const results: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.check();
    results.push(`${passed ? '✔' : '✖'} ${check.name} ${passed ? 'installed' : 'NOT found'}`);
    if (!passed) {
      allPassed = false;
    }
  }

  // Check if $HOME/.dotnet/tools is in PATH
  const dotnetToolsPath = process.env.HOME
    ? path.join(process.env.HOME, '.dotnet', 'tools')
    : path.join(process.env.USERPROFILE || '', '.dotnet', 'tools');
  const pathEnv = process.env.PATH || '';
  const pathEntries = pathEnv.split(path.delimiter).map((p) => path.normalize(p));
  const toolsInPath = pathEntries.includes(path.normalize(dotnetToolsPath));

  results.push(
    `${toolsInPath ? '✔' : '✖'} $HOME/.dotnet/tools ${toolsInPath ? 'in PATH' : 'NOT in PATH'}`
  );
  if (!toolsInPath) {
    allPassed = false;
  }

  console.log('C# Tools Verification:');
  results.forEach((result) => console.log(`  ${result}`));

  if (!allPassed) {
    console.warn('\n⚠️  Warning: Some C# tools are missing. C# tests may fail.');
    console.warn('Please install missing tools:');
    console.warn('  - .NET SDK 8.0.x: https://dotnet.microsoft.com/download/dotnet/8.0');
    console.warn('  - ilspycmd: dotnet tool install --global ilspycmd');
    console.warn('  - paket: dotnet tool install --global paket');
    console.warn('  - Add to PATH: export PATH="$HOME/.dotnet/tools:$PATH"\n');
  } else {
    console.log('✅ All C# tools verified successfully.\n');
  }
}
