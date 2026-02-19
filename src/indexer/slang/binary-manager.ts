/**
 * Slang Binary Manager
 *
 * Handles locating and managing the slang binary executable.
 * Supports environment variable overrides, bundled binaries, system PATH,
 * and auto-download from GitHub releases.
 *
 * @module slang/binary-manager
 */

import { existsSync, createWriteStream } from 'fs';
import { access, constants, mkdir, rm, chmod, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform, arch, homedir } from 'os';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { extract as tarExtract } from 'tar';

const execPromise = promisify(exec);

// ============================================================================
// Types
// ============================================================================

/**
 * Platform identifier for binary selection.
 */
type Platform = 'win32' | 'darwin' | 'linux';

/**
 * Architecture identifier for binary selection.
 */
type Architecture = 'x64' | 'arm64';

/**
 * Binary location result.
 */
interface BinaryLocation {
  /** Path to the binary */
  path: string;

  /** How the binary was found */
  source: 'bundled' | 'env' | 'path' | 'system' | 'downloaded';

  /** Slang version (if detectable) */
  version?: string;
}

/**
 * Download progress callback.
 */
type DownloadProgressCallback = (progress: {
  phase: 'fetching' | 'downloading' | 'extracting' | 'done';
  percent?: number;
  message: string;
}) => void;

// ============================================================================
// Constants
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Directory where bundled binaries are stored.
 */
const BUNDLED_DIR = join(__dirname, '..', '..', '..', 'binaries', 'slang');

/**
 * Directory where downloaded binaries are cached.
 */
const CACHE_DIR = join(homedir(), '.gateflow', 'slang');

/**
 * Environment variable for custom slang path.
 */
const SLANG_PATH_ENV = 'SLANG_PATH';

/**
 * GitHub API URL for latest release.
 */
const GITHUB_RELEASES_API = 'https://api.github.com/repos/MikePopoloski/slang/releases/latest';

/**
 * Binary name.
 */
const SLANG_BINARY = 'slang';

/**
 * Binary extensions by platform.
 */
const BINARY_EXTENSION: Record<Platform, string> = {
  win32: '.exe',
  darwin: '',
  linux: '',
};

/**
 * Platform identifiers in Slang release filenames.
 */
const RELEASE_PLATFORM_MAP: Record<Platform, string[]> = {
  win32: ['win64', 'windows'],
  darwin: ['macOS', 'macos', 'darwin'],
  linux: ['linux'],
};

/**
 * Architecture identifiers in Slang release filenames.
 */
const RELEASE_ARCH_MAP: Record<Architecture, string[]> = {
  x64: ['x86_64', 'x64', 'amd64'],
  arm64: ['arm64', 'aarch64'],
};

/**
 * Archive extensions by platform.
 */
const ARCHIVE_EXTENSION: Record<Platform, string> = {
  win32: '.zip',
  darwin: '.tar.gz',
  linux: '.tar.gz',
};

// ============================================================================
// Binary Manager Class
// ============================================================================

/**
 * Manages slang binary discovery and execution.
 */
class SlangBinaryManager {
  private cachedPath?: BinaryLocation;
  private readonly platform: Platform;
  private readonly arch: Architecture;
  private downloadInProgress: Promise<string> | null = null;

  constructor() {
    this.platform = platform() as Platform;
    this.arch = arch() as Architecture;
  }

  /**
   * Find the slang binary.
   *
   * Search order:
   * 1. SLANG_PATH environment variable
   * 2. Downloaded binaries (cache)
   * 3. Bundled binaries
   * 4. System PATH
   * 5. Auto-download (if autoDownload is true)
   *
   * @param autoDownload - Whether to auto-download if not found (default: true)
   * @param onProgress - Optional progress callback for downloads
   * @returns Binary location info
   * @throws Error if binary not found and download fails/disabled
   */
  async findBinary(
    autoDownload = true,
    onProgress?: DownloadProgressCallback
  ): Promise<BinaryLocation> {
    // Check cache first
    if (this.cachedPath) {
      return this.cachedPath;
    }

    // Try each source in order
    let location =
      (await this.tryEnvPath()) ||
      (await this.tryDownloadedPath()) ||
      (await this.tryBundledPath()) ||
      (await this.trySystemPath());

    // If not found and auto-download enabled, try downloading
    if (!location && autoDownload) {
      try {
        await this.downloadSlang(onProgress);
        location = await this.tryDownloadedPath();
      } catch (err) {
        // Download failed, will throw below
      }
    }

    if (!location) {
      throw new Error(
        `slang binary not found. ` +
          `Install slang or set ${SLANG_PATH_ENV} environment variable. ` +
          `See: https://github.com/MikePopoloski/slang`
      );
    }

    // Cache and return
    this.cachedPath = location;
    return location;
  }

  /**
   * Check if slang is available.
   *
   * @param autoDownload - Whether to try auto-download (default: false for checks)
   * @returns true if available
   */
  async isAvailable(autoDownload = false): Promise<boolean> {
    try {
      await this.findBinary(autoDownload);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get slang version.
   *
   * @returns Version string or undefined
   */
  async getVersion(): Promise<string | undefined> {
    try {
      const location = await this.findBinary(false);
      return location.version || this.detectVersion(location.path);
    } catch {
      return undefined;
    }
  }

  /**
   * Download slang binaries from GitHub releases.
   *
   * @param onProgress - Optional progress callback
   * @returns Path to downloaded binary
   */
  async downloadSlang(onProgress?: DownloadProgressCallback): Promise<string> {
    // Prevent concurrent downloads
    if (this.downloadInProgress) {
      return this.downloadInProgress;
    }

    this.downloadInProgress = this.doDownload(onProgress);

    try {
      return await this.downloadInProgress;
    } finally {
      this.downloadInProgress = null;
    }
  }

  /**
   * Clear the binary path cache.
   */
  clearCache(): void {
    this.cachedPath = undefined;
  }

  /**
   * Remove downloaded slang binaries.
   */
  async clearDownloads(): Promise<void> {
    if (existsSync(CACHE_DIR)) {
      await rm(CACHE_DIR, { recursive: true, force: true });
    }
    this.clearCache();
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Try to find binary from SLANG_PATH environment variable.
   */
  private async tryEnvPath(): Promise<BinaryLocation | null> {
    const envPath = process.env[SLANG_PATH_ENV];
    if (!envPath) {
      return null;
    }

    // Check if envPath is a directory or direct binary path
    let binaryPath = envPath;
    if (existsSync(envPath) && !envPath.endsWith(this.getBinaryName())) {
      // It's a directory, append binary name
      binaryPath = join(envPath, this.getBinaryName());
    }

    if (await this.isExecutable(binaryPath)) {
      return {
        path: binaryPath,
        source: 'env',
        version: this.detectVersion(binaryPath),
      };
    }

    return null;
  }

  /**
   * Try to find downloaded binary in cache.
   */
  private async tryDownloadedPath(): Promise<BinaryLocation | null> {
    if (!existsSync(CACHE_DIR)) {
      return null;
    }

    try {
      const binDir = await this.findBinDirectory(CACHE_DIR);
      const binaryPath = join(binDir, this.getBinaryName());

      if (await this.isExecutable(binaryPath)) {
        return {
          path: binaryPath,
          source: 'downloaded',
          version: this.detectVersion(binaryPath),
        };
      }
    } catch {
      // No valid bin directory found
    }

    return null;
  }

  /**
   * Try to find bundled binary for current platform.
   */
  private async tryBundledPath(): Promise<BinaryLocation | null> {
    const platformDir = this.getPlatformDir();
    const binaryPath = join(BUNDLED_DIR, platformDir, this.getBinaryName());

    if (await this.isExecutable(binaryPath)) {
      return {
        path: binaryPath,
        source: 'bundled',
        version: this.detectVersion(binaryPath),
      };
    }

    return null;
  }

  /**
   * Try to find binary in system PATH.
   */
  private async trySystemPath(): Promise<BinaryLocation | null> {
    try {
      const binaryName = this.getBinaryName();

      // Use 'where' on Windows, 'which' elsewhere
      const command = this.platform === 'win32' ? `where ${binaryName}` : `which ${binaryName}`;

      const result = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
      const binaryPath = result.trim().split('\n')[0]; // First result

      if (binaryPath && (await this.isExecutable(binaryPath))) {
        return {
          path: binaryPath,
          source: 'path',
          version: this.detectVersion(binaryPath),
        };
      }
    } catch {
      // Not found in PATH
    }

    return null;
  }

  /**
   * Get platform-specific directory name.
   */
  private getPlatformDir(): string {
    return `${this.platform}-${this.arch}`;
  }

  /**
   * Get binary name with platform-specific extension.
   */
  private getBinaryName(): string {
    const ext = BINARY_EXTENSION[this.platform] || '';
    return SLANG_BINARY + ext;
  }

  /**
   * Check if a file exists and is executable.
   */
  private async isExecutable(filePath: string): Promise<boolean> {
    try {
      if (!existsSync(filePath)) {
        return false;
      }

      // Check execute permission
      await access(filePath, constants.X_OK);
      return true;
    } catch {
      // On Windows, .exe files are always "executable"
      if (this.platform === 'win32' && existsSync(filePath)) {
        return true;
      }
      return false;
    }
  }

  /**
   * Detect slang version from binary.
   */
  private detectVersion(binaryPath: string): string | undefined {
    try {
      const result = execSync(`"${binaryPath}" --version`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 5000,
      });

      // Parse version from output
      // slang version output format: "slang version X.Y.Z" or similar
      const match = result.match(/v?(\d+\.\d+(?:\.\d+)?)/);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Download Implementation
  // ---------------------------------------------------------------------------

  /**
   * Perform the actual download.
   */
  private async doDownload(onProgress?: DownloadProgressCallback): Promise<string> {
    const report = (phase: 'fetching' | 'downloading' | 'extracting' | 'done', message: string, percent?: number) => {
      onProgress?.({ phase, message, percent });
    };

    report('fetching', 'Fetching latest slang release info...');

    // Get latest release info from GitHub
    const releaseInfo = await this.fetchReleaseInfo();
    const assetUrl = this.findAssetUrl(releaseInfo);

    if (!assetUrl) {
      throw new Error(`No slang release found for platform: ${this.platform}-${this.arch}`);
    }

    // Create cache directory
    await mkdir(CACHE_DIR, { recursive: true });

    const archiveExt = ARCHIVE_EXTENSION[this.platform];
    const archivePath = join(CACHE_DIR, `slang${archiveExt}`);

    report('downloading', `Downloading slang from ${assetUrl}...`);

    // Download the archive
    await this.downloadFile(assetUrl, archivePath, (percent) => {
      report('downloading', `Downloading slang... ${percent}%`, percent);
    });

    report('extracting', 'Extracting slang binaries...');

    // Extract the archive, ensuring cleanup even on failure
    try {
      await this.extractArchive(archivePath, CACHE_DIR);
    } finally {
      // Clean up archive regardless of success/failure
      await rm(archivePath, { force: true });
    }

    // Find the bin directory
    const binDir = await this.findBinDirectory(CACHE_DIR);

    report('done', `slang installed to ${binDir}`);

    return binDir;
  }

  /**
   * Fetch release info from GitHub API.
   */
  private async fetchReleaseInfo(): Promise<any> {
    const response = await fetch(GITHUB_RELEASES_API, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'gateflow-cli',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch release info: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Find the appropriate asset URL for this platform.
   */
  private findAssetUrl(releaseInfo: any): string | null {
    const assets = releaseInfo.assets || [];
    const platformKeys = RELEASE_PLATFORM_MAP[this.platform];
    const archKeys = RELEASE_ARCH_MAP[this.arch];
    const archiveExt = ARCHIVE_EXTENSION[this.platform];

    for (const asset of assets) {
      const name = (asset.name as string).toLowerCase();

      // Check if this asset matches our platform and architecture
      const matchesPlatform = platformKeys.some((key) => name.includes(key.toLowerCase()));
      const matchesArch = archKeys.some((key) => name.includes(key.toLowerCase()));
      const matchesExtension = name.endsWith(archiveExt);

      if (matchesPlatform && matchesArch && matchesExtension) {
        return asset.browser_download_url;
      }
    }

    // Fallback: Try platform-only match for common naming patterns
    for (const asset of assets) {
      const name = (asset.name as string).toLowerCase();
      const matchesPlatform = platformKeys.some((key) => name.includes(key.toLowerCase()));
      const matchesExtension = name.endsWith(archiveExt);

      if (matchesPlatform && matchesExtension) {
        return asset.browser_download_url;
      }
    }

    return null;
  }

  /**
   * Download a file with progress tracking.
   */
  private async downloadFile(
    url: string,
    destPath: string,
    onProgress?: (percent: number) => void
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

        if (contentLength > 0 && onProgress) {
          const percent = Math.round((downloaded / contentLength) * 100);
          onProgress(percent);
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
   * Extract an archive (zip or tar.gz).
   */
  private async extractArchive(archivePath: string, destDir: string): Promise<void> {
    if (this.platform === 'win32') {
      // Use PowerShell to extract zip on Windows
      // Pass arguments as array to avoid command injection
      const { spawn } = await import('child_process');
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Expand-Archive',
          '-Path', archivePath,
          '-DestinationPath', destDir,
          '-Force'
        ], { stdio: 'pipe' });

        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`PowerShell Expand-Archive failed with code ${code}`));
          }
        });
      });
    } else {
      // Use tar for tar.gz on Unix
      await tarExtract({
        file: archivePath,
        cwd: destDir,
      });
    }

    // Make binary executable on Unix
    if (this.platform !== 'win32') {
      try {
        const binDir = await this.findBinDirectory(destDir);
        const binaryPath = join(binDir, this.getBinaryName());
        if (existsSync(binaryPath)) {
          await chmod(binaryPath, 0o755);
        }
      } catch {
        // Ignore chmod errors
      }
    }
  }

  /**
   * Find the bin directory inside extracted archive.
   * Slang may extract to a versioned folder like 'slang-X.Y.Z/bin'
   */
  private async findBinDirectory(baseDir: string): Promise<string> {
    const entries = await readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('slang')) {
        // Check for bin subdirectory
        const binPath = join(baseDir, entry.name, 'bin');
        if (existsSync(binPath)) {
          return binPath;
        }
        // Check if binary is directly in the folder
        const directPath = join(baseDir, entry.name);
        const binaryPath = join(directPath, this.getBinaryName());
        if (existsSync(binaryPath)) {
          return directPath;
        }
      }
    }

    // Check if binary is directly in cache dir
    const directBinary = join(baseDir, this.getBinaryName());
    if (existsSync(directBinary)) {
      return baseDir;
    }

    // Check for bin subdirectory directly
    const directBin = join(baseDir, 'bin');
    if (existsSync(directBin)) {
      const binaryPath = join(directBin, this.getBinaryName());
      if (existsSync(binaryPath)) {
        return directBin;
      }
    }

    throw new Error('Could not find slang binary in extracted archive');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Default binary manager instance.
 */
export const slangBinaryManager = new SlangBinaryManager();

/**
 * Find the slang binary (convenience function).
 */
export async function findSlangBinary(): Promise<BinaryLocation> {
  return slangBinaryManager.findBinary();
}

/**
 * Check if slang is available (convenience function).
 */
export async function isSlangAvailable(): Promise<boolean> {
  return slangBinaryManager.isAvailable();
}

/**
 * Download slang binaries (convenience function).
 */
async function downloadSlang(onProgress?: DownloadProgressCallback): Promise<string> {
  return slangBinaryManager.downloadSlang(onProgress);
}

/**
 * Get slang version (convenience function).
 */
export async function getSlangVersion(): Promise<string | undefined> {
  return slangBinaryManager.getVersion();
}
