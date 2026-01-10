#!/usr/bin/env node

/**
 * Slang Binary Download Script
 *
 * Downloads slang binaries from GitHub releases for the current platform.
 * Used during `npm install` or manually to set up slang.
 *
 * Usage:
 *   node scripts/download-slang.js [--version <version>]
 *
 * Environment:
 *   SLANG_VERSION - Override version to download
 *   SLANG_SKIP_DOWNLOAD - Skip download if set to "1"
 */

import { existsSync, mkdirSync, createWriteStream, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform, arch } from 'os';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Extract } from 'unzipper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const GITHUB_REPO = 'MikePopoloski/slang';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

const BINARIES_DIR = join(__dirname, '..', 'binaries', 'slang');

// Platform-specific release asset patterns
// Slang releases use patterns like: slang-<version>-<platform>.tar.gz
const PLATFORM_PATTERNS = {
  'darwin-x64': ['macos', 'darwin', 'x86_64'],
  'darwin-arm64': ['macos', 'darwin', 'arm64'],
  'linux-x64': ['linux', 'x86_64'],
  'linux-arm64': ['linux', 'arm64', 'aarch64'],
  'win32-x64': ['win64', 'windows', 'x64'],
};

const ARCHIVE_EXTENSION = {
  'darwin-x64': '.tar.gz',
  'darwin-arm64': '.tar.gz',
  'linux-x64': '.tar.gz',
  'linux-arm64': '.tar.gz',
  'win32-x64': '.zip',
};

const BINARY_NAME = platform() === 'win32' ? 'slang.exe' : 'slang';

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Check for skip flag
  if (process.env.SLANG_SKIP_DOWNLOAD === '1') {
    console.log('Skipping slang download (SLANG_SKIP_DOWNLOAD=1)');
    return;
  }

  const platformKey = getPlatformKey();

  if (!platformKey) {
    console.warn(`Unsupported platform: ${platform()}-${arch()}`);
    console.warn('slang will not be bundled. You can install it manually.');
    return;
  }

  console.log(`Downloading slang for ${platformKey}...`);

  try {
    await downloadSlang(platformKey);
    console.log('slang downloaded successfully!');
  } catch (error) {
    console.error('Failed to download slang:', error.message);
    console.error('You can install slang manually: https://github.com/MikePopoloski/slang');
    process.exit(1);
  }
}

// ============================================================================
// Download Functions
// ============================================================================

async function downloadSlang(platformKey) {
  // Fetch latest release info
  console.log('Fetching latest release info...');
  const response = await fetch(GITHUB_API, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'gateflow-cli',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch release info: ${response.status} ${response.statusText}`);
  }

  const releaseInfo = await response.json();
  const version = releaseInfo.tag_name;
  console.log(`Latest version: ${version}`);

  // Find matching asset
  const assetUrl = findAssetUrl(releaseInfo, platformKey);
  if (!assetUrl) {
    throw new Error(`No release found for platform: ${platformKey}`);
  }

  const targetDir = join(BINARIES_DIR, platformKey);
  mkdirSync(targetDir, { recursive: true });

  console.log(`Downloading from: ${assetUrl}`);

  // Download the archive
  const archiveResponse = await fetch(assetUrl, {
    headers: { 'User-Agent': 'gateflow-cli' },
  });

  if (!archiveResponse.ok) {
    throw new Error(`HTTP ${archiveResponse.status}: ${archiveResponse.statusText}`);
  }

  const archiveExt = ARCHIVE_EXTENSION[platformKey];
  const archivePath = join(BINARIES_DIR, `slang${archiveExt}`);

  // Save to file
  const fileStream = createWriteStream(archivePath);
  await pipeline(archiveResponse.body, fileStream);

  console.log('Extracting binaries...');

  // Extract based on file type
  if (archiveExt === '.tar.gz') {
    await extractTarGz(archivePath, targetDir);
  } else if (archiveExt === '.zip') {
    await extractZip(archivePath, targetDir);
  }

  // Clean up archive
  try {
    execSync(`rm -f "${archivePath}"`, { stdio: 'ignore' });
  } catch {
    // Ignore cleanup errors on Windows
  }

  // Make binary executable (Unix only)
  if (platform() !== 'win32') {
    const binaryPath = join(targetDir, BINARY_NAME);
    if (existsSync(binaryPath)) {
      chmodSync(binaryPath, 0o755);
    }
  }

  console.log(`Binary installed to: ${targetDir}`);
}

function findAssetUrl(releaseInfo, platformKey) {
  const assets = releaseInfo.assets || [];
  const patterns = PLATFORM_PATTERNS[platformKey];
  const archiveExt = ARCHIVE_EXTENSION[platformKey];

  for (const asset of assets) {
    const name = asset.name.toLowerCase();

    // Check if all patterns match and extension matches
    const matchesPatterns = patterns.every(p => name.includes(p.toLowerCase()));
    const matchesExtension = name.endsWith(archiveExt);

    if (matchesPatterns && matchesExtension) {
      return asset.browser_download_url;
    }
  }

  // Fallback: Try partial matches
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    const matchesSome = patterns.some(p => name.includes(p.toLowerCase()));
    const matchesExtension = name.endsWith(archiveExt);

    if (matchesSome && matchesExtension) {
      return asset.browser_download_url;
    }
  }

  return null;
}

async function extractTarGz(archivePath, targetDir) {
  // Use tar command (available on macOS and Linux)
  try {
    // Try to extract just the binary
    const cmd = `tar -xzf "${archivePath}" -C "${targetDir}" --strip-components=1`;
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    // Fallback: extract everything
    execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { stdio: 'inherit' });
  }

  // Find and move binary to target dir if needed
  const binaryPath = join(targetDir, BINARY_NAME);
  if (!existsSync(binaryPath)) {
    try {
      const found = execSync(`find "${targetDir}" -name "${BINARY_NAME}" -type f`, { encoding: 'utf-8' }).trim();
      if (found) {
        execSync(`mv "${found}" "${targetDir}/"`, { stdio: 'inherit' });
      }
    } catch {
      // Binary might already be in the right place
    }
  }
}

async function extractZip(archivePath, targetDir) {
  // Use PowerShell on Windows
  if (platform() === 'win32') {
    const cmd = `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${targetDir}' -Force"`;
    execSync(cmd, { stdio: 'inherit' });

    // Find and move binary if needed
    const binaryPath = join(targetDir, BINARY_NAME);
    if (!existsSync(binaryPath)) {
      try {
        // Search for slang.exe in subdirectories
        const searchCmd = `powershell -Command "Get-ChildItem -Path '${targetDir}' -Recurse -Filter '${BINARY_NAME}' | Select-Object -First 1 -ExpandProperty FullName"`;
        const found = execSync(searchCmd, { encoding: 'utf-8' }).trim();
        if (found) {
          execSync(`move /Y "${found}" "${targetDir}\\"`, { stdio: 'inherit', shell: true });
        }
      } catch {
        // Binary might already be in the right place
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
