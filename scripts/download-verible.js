#!/usr/bin/env node

/**
 * Verible Binary Download Script
 *
 * Downloads Verible binaries from GitHub releases for the current platform.
 * Used during `npm install` or manually to set up Verible.
 *
 * Usage:
 *   node scripts/download-verible.js [--version <version>]
 *
 * Environment:
 *   VERIBLE_VERSION - Override version to download
 *   VERIBLE_SKIP_DOWNLOAD - Skip download if set to "1"
 */

import { existsSync, mkdirSync, createWriteStream, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform, arch } from 'os';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { Extract } from 'unzipper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const GITHUB_REPO = 'chipsalliance/verible';
const DEFAULT_VERSION = 'v0.0-3644-g6a908f79'; // Latest stable as of 2024

const BINARIES_DIR = join(__dirname, '..', 'binaries');

// Platform-specific release asset patterns
const ASSET_PATTERNS = {
  'darwin-x64': 'verible-VERSION-darwin-x86_64.tar.gz',
  'darwin-arm64': 'verible-VERSION-darwin-arm64.tar.gz',
  'linux-x64': 'verible-VERSION-linux-static-x86_64.tar.gz',
  'linux-arm64': 'verible-VERSION-linux-static-arm64.tar.gz',
  'win32-x64': 'verible-VERSION-win64.zip',
};

const BINARIES = [
  'verible-verilog-syntax',
  'verible-verilog-lint',
  'verible-verilog-format',
];

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Check for skip flag
  if (process.env.VERIBLE_SKIP_DOWNLOAD === '1') {
    console.log('Skipping Verible download (VERIBLE_SKIP_DOWNLOAD=1)');
    return;
  }

  const version = process.env.VERIBLE_VERSION || getVersionArg() || DEFAULT_VERSION;
  const platformKey = getPlatformKey();

  if (!platformKey) {
    console.warn(`Unsupported platform: ${platform()}-${arch()}`);
    console.warn('Verible will not be bundled. You can install it manually.');
    return;
  }

  console.log(`Downloading Verible ${version} for ${platformKey}...`);

  try {
    await downloadVerible(version, platformKey);
    console.log('Verible downloaded successfully!');
  } catch (error) {
    console.error('Failed to download Verible:', error.message);
    console.error('You can install Verible manually: https://github.com/chipsalliance/verible');
    process.exit(1);
  }
}

// ============================================================================
// Download Functions
// ============================================================================

async function downloadVerible(version, platformKey) {
  const assetPattern = ASSET_PATTERNS[platformKey];
  if (!assetPattern) {
    throw new Error(`No asset pattern for platform: ${platformKey}`);
  }

  const assetName = assetPattern.replace('VERSION', version);
  const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/${version}/${assetName}`;

  const targetDir = join(BINARIES_DIR, platformKey);
  mkdirSync(targetDir, { recursive: true });

  console.log(`Downloading from: ${downloadUrl}`);

  // Download the archive
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const archivePath = join(BINARIES_DIR, assetName);

  // Save to file
  const fileStream = createWriteStream(archivePath);
  await pipeline(response.body, fileStream);

  console.log('Extracting binaries...');

  // Extract based on file type
  if (assetName.endsWith('.tar.gz')) {
    await extractTarGz(archivePath, targetDir);
  } else if (assetName.endsWith('.zip')) {
    await extractZip(archivePath, targetDir);
  }

  // Clean up archive
  try {
    execSync(`rm -f "${archivePath}"`, { stdio: 'ignore' });
  } catch {
    // Ignore cleanup errors on Windows
  }

  // Make binaries executable (Unix only)
  if (platform() !== 'win32') {
    for (const binary of BINARIES) {
      const binaryPath = join(targetDir, binary);
      if (existsSync(binaryPath)) {
        chmodSync(binaryPath, 0o755);
      }
    }
  }

  console.log(`Binaries installed to: ${targetDir}`);
}

async function extractTarGz(archivePath, targetDir) {
  // Use tar command (available on macOS and Linux)
  const cmd = `tar -xzf "${archivePath}" -C "${targetDir}" --strip-components=2 --wildcards "*/bin/*"`;
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    // Fallback: extract everything and move binaries
    execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { stdio: 'inherit' });
    // Find and move binaries
    for (const binary of BINARIES) {
      const found = execSync(`find "${targetDir}" -name "${binary}" -type f`, { encoding: 'utf-8' }).trim();
      if (found) {
        execSync(`mv "${found}" "${targetDir}/"`, { stdio: 'inherit' });
      }
    }
  }
}

async function extractZip(archivePath, targetDir) {
  // Use PowerShell on Windows
  if (platform() === 'win32') {
    const cmd = `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${targetDir}' -Force"`;
    execSync(cmd, { stdio: 'inherit' });

    // Move binaries to target dir
    const extractedDir = join(targetDir, 'verible-' + DEFAULT_VERSION.replace('v', ''));
    for (const binary of BINARIES) {
      const src = join(extractedDir, 'bin', binary + '.exe');
      const dst = join(targetDir, binary + '.exe');
      if (existsSync(src)) {
        execSync(`move /Y "${src}" "${dst}"`, { stdio: 'inherit', shell: true });
      }
    }
  } else {
    // Use unzip on Unix
    execSync(`unzip -o "${archivePath}" -d "${targetDir}"`, { stdio: 'inherit' });
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getPlatformKey() {
  const p = platform();
  const a = arch();

  if (p === 'darwin' && a === 'x64') return 'darwin-x64';
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  if (p === 'win32' && a === 'x64') return 'win32-x64';

  return null;
}

function getVersionArg() {
  const args = process.argv.slice(2);
  const versionIdx = args.indexOf('--version');
  if (versionIdx !== -1 && args[versionIdx + 1]) {
    return args[versionIdx + 1];
  }
  return null;
}

// ============================================================================
// Run
// ============================================================================

main().catch(console.error);
