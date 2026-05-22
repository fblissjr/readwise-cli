#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve key paths relative to the wrapper location
const rootDir = path.resolve(__dirname, '..');
const tsEntry = path.join(rootDir, 'src/index.ts');
const jsEntry = path.join(rootDir, 'dist/index.js');

// Check if we are running in the development workspace where TS source exists
const isDevWorkspace = fs.existsSync(tsEntry);

// Function to check if a command exists on PATH
function hasCommand(cmd) {
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(checkCmd, [cmd], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

if (isDevWorkspace && hasCommand('bun')) {
  // We are in the dev environment and bun is available.
  // Execute the TypeScript file directly using Bun, forwarding all arguments.
  const args = [tsEntry, ...process.argv.slice(2)];
  const result = spawnSync('bun', args, {
    stdio: 'inherit',
    env: { ...process.env, BUN_DEV_WRAPPER: 'true' }
  });
  process.exit(result.status ?? 0);
} else {
  // We are either in production (src/index.ts is missing) or Bun is not installed.
  // Fall back to running the compiled JavaScript production bundle.
  if (fs.existsSync(jsEntry)) {
    // Import the compiled entry point directly to run it in the same process
    await import(jsEntry);
  } else {
    console.error(`Error: Production build not found at ${jsEntry}.`);
    console.error('Please run "bun run build" to compile the TypeScript files.');
    process.exit(1);
  }
}
