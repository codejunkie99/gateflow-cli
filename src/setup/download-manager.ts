/**
 * Download Manager
 *
 * Handles secure, verified downloads of tool binaries.
 * Implements checksum verification, progress reporting, and caching.
 *
 * @module setup/download-manager
 */

import { createWriteStream, existsSync, createReadStream } from 'fs';
import { mkdir, rm, rename, readdir, chmod } from 'fs/promises';
import { join, basename } from 'path';
import { homedir, platform } from 'os';
import { extract as tarExtract } from 'tar';
import { spawn } from 'child_process';

import {
  TOOL_MANIFEST,
  getToolAsset,
  getToolDefinition,
  formatSize,
  type ToolAsset,
} from './manifest.js';
import {
  verifySHA256,
  formatChecksumError,
  isChecksumPlaceholder,
} from './checksum.js';
import {
  loadPreferences,
  markToolInstalled,
  isDomainTrusted,
  getGateflowDir,
} from './preferences.js';

// ============================================================================
// Types
// ============================================================================

export type DownloadPhase =
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'complete'
  | 'error';

export interface DownloadProgress {
  phase: DownloadPhase;
  percent?: number;
  message: string;
  bytesDownloaded?: number;
  totalBytes?: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export interface DownloadResult {
  success: boolean;
  tool: 'verible' | 'slang';
  version: string;
  path: string;
  cached: boolean;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const CACHE_DIR = join(getGateflowDir(), 'downloads');
const TOOLS_DIR = join(getGateflowDir(), 'tools');

// ============================================================================
// Core Download Functions
// ============================================================================

/**
 * Download a tool binary with verification.
 *
 * @param tool - Tool to download ('verible' or 'slang')
 * @param onProgress - Progress callback
 * @returns Download result
 */
export async function downloadTool(
  tool: 'verible' | 'slang',
  onProgress?: ProgressCallback
): Promise<DownloadResult> {
  const report = (
    phase: DownloadPhase,
    message: string,
    percent?: number,
    bytesDownloaded?: number,
    totalBytes?: number
  ) => {
    onProgress?.({ phase, message, percent, bytesDownloaded, totalBytes });
  };

  const toolDef = getToolDefinition(tool);
  const asset = getToolAsset(tool);

  if (!asset) {
    const error = `${toolDef.name} is not available for your platform`;
    report('error', error);
    return { success: false, tool, version: '', path: '', cached: false, error };
  }

  try {
    // 1. Check cache first
    report('checking', `Checking for cached ${toolDef.name}...`);
    const cachedPath = await checkCache(tool, toolDef.latest.version);
    if (cachedPath) {
      report('complete', `Using cached ${toolDef.name} ${toolDef.latest.version}`);
      return {
        success: true,
        tool,
        version: toolDef.latest.version,
        path: cachedPath,
        cached: true,
      };
    }

    // 2. Verify domain is trusted
    const prefs = await loadPreferences();
    if (!isDomainTrusted(asset.url, prefs.trustedDomains)) {
      const error = `Download URL domain is not trusted: ${new URL(asset.url).hostname}`;
      report('error', error);
      return { success: false, tool, version: '', path: '', cached: false, error };
    }

    // 3. Create directories
    await mkdir(CACHE_DIR, { recursive: true });
    await mkdir(TOOLS_DIR, { recursive: true });

    // 4. Download
    const archiveName = basename(new URL(asset.url).pathname);
    const archivePath = join(CACHE_DIR, archiveName);

    report('downloading', `Downloading ${toolDef.name} (${formatSize(asset.size)})...`, 0);

    await downloadFile(asset.url, archivePath, (percent, downloaded, total) => {
      report('downloading', `Downloading ${toolDef.name}...`, percent, downloaded, total);
    });

    // 5. Verify checksum
    report('verifying', 'Verifying SHA-256 checksum...', 0);

    if (!isChecksumPlaceholder(asset.sha256)) {
      const verification = await verifySHA256(archivePath, asset.sha256, (percent) => {
        report('verifying', 'Verifying checksum...', percent);
      });

      if (!verification.valid) {
        await rm(archivePath, { force: true });
        const error = formatChecksumError(verification);
        report('error', 'Checksum verification failed!');
        return { success: false, tool, version: '', path: '', cached: false, error };
      }
    } else {
      report('verifying', 'WARNING: Checksum not configured - skipping verification');
    }

    // 6. Extract
    const extractDir = join(TOOLS_DIR, tool, toolDef.latest.version);
    await mkdir(extractDir, { recursive: true });

    report('extracting', `Extracting ${toolDef.name}...`);
    await extractArchive(archivePath, extractDir);

    // 7. Find binary and make executable
    const binaryPath = await findBinaryInDir(extractDir, toolDef.binaryName);
    if (!binaryPath) {
      const error = `Could not find ${toolDef.binaryName} binary after extraction`;
      report('error', error);
      return { success: false, tool, version: '', path: '', cached: false, error };
    }

    if (platform() !== 'win32') {
      await chmod(binaryPath, 0o755);
    }

    // 8. Clean up archive
    await rm(archivePath, { force: true });

    // 9. Update preferences
    await markToolInstalled(tool, toolDef.latest.version, binaryPath);

    report('complete', `${toolDef.name} ${toolDef.latest.version} installed successfully`);

    return {
      success: true,
      tool,
      version: toolDef.latest.version,
      path: binaryPath,
      cached: false,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    report('error', error);
    return { success: false, tool, version: '', path: '', cached: false, error };
  }
}

/**
 * Check if a tool version is already cached.
 */
async function checkCache(
  tool: 'verible' | 'slang',
  version: string
): Promise<string | null> {
  const toolDef = getToolDefinition(tool);
  const extractDir = join(TOOLS_DIR, tool, version);

  if (!existsSync(extractDir)) {
    return null;
  }

  const binaryPath = await findBinaryInDir(extractDir, toolDef.binaryName);
  return binaryPath;
}

/**
 * Download a file with progress reporting.
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number, downloaded: number, total: number) => void
): Promise<void> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'gateflow-cli' },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  const writer = createWriteStream(destPath);

  if (!response.body) {
    throw new Error('No response body');
  }

  let downloaded = 0;
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writer.write(Buffer.from(value));
      downloaded += value.length;

      if (onProgress && contentLength > 0) {
        const percent = Math.round((downloaded / contentLength) * 100);
        onProgress(percent, downloaded, contentLength);
      }
    }
  } finally {
    writer.end();
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }
}

/**
 * Extract an archive (.zip or .tar.gz).
 */
async function extractArchive(
  archivePath: string,
  destDir: string
): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    if (platform() === 'win32') {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Expand-Archive',
            '-Path',
            archivePath,
            '-DestinationPath',
            destDir,
            '-Force',
          ],
          { stdio: 'pipe' }
        );
        proc.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`Exit ${code}`))
        );
        proc.on('error', reject);
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('unzip', ['-o', archivePath, '-d', destDir], {
          shell: false,
          stdio: 'pipe',
        });
        proc.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`unzip exited with code ${code}`))
        );
        proc.on('error', reject);
      });
    }
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    await tarExtract({ file: archivePath, cwd: destDir });
  } else {
    throw new Error(`Unsupported archive format: ${archivePath}`);
  }
}

/**
 * Find a binary in a directory (handles nested folders).
 */
async function findBinaryInDir(
  dir: string,
  binaryName: string
): Promise<string | null> {
  const ext = platform() === 'win32' ? '.exe' : '';
  const targetName = binaryName + ext;

  async function searchDir(currentDir: string): Promise<string | null> {
    if (!existsSync(currentDir)) return null;

    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isFile() && entry.name === targetName) {
        return fullPath;
      }

      if (entry.isDirectory()) {
        // Check common bin subdirectories
        if (entry.name === 'bin') {
          const binPath = join(fullPath, targetName);
          if (existsSync(binPath)) return binPath;
        }

        // Recurse into subdirectories (max 2 levels)
        const result = await searchDir(fullPath);
        if (result) return result;
      }
    }

    return null;
  }

  return searchDir(dir);
}

// ============================================================================
// Status Functions
// ============================================================================

/**
 * Get current status of all tools.
 */
export async function getToolsStatus(): Promise<{
  verible: { installed: boolean; version?: string; path?: string };
  slang: { installed: boolean; version?: string; path?: string };
}> {
  const prefs = await loadPreferences();

  return {
    verible: {
      installed: !!prefs.installedTools.verible,
      version: prefs.installedTools.verible?.version,
      path: prefs.installedTools.verible?.path,
    },
    slang: {
      installed: !!prefs.installedTools.slang,
      version: prefs.installedTools.slang?.version,
      path: prefs.installedTools.slang?.path,
    },
  };
}

/**
 * Clear cached downloads.
 */
export async function clearCache(): Promise<void> {
  if (existsSync(CACHE_DIR)) {
    await rm(CACHE_DIR, { recursive: true, force: true });
  }
}

/**
 * Get paths for exports.
 */
export function getCacheDir(): string {
  return CACHE_DIR;
}

export function getToolsDir(): string {
  return TOOLS_DIR;
}
