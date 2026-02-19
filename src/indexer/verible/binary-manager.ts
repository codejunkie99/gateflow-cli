/**
 * Verible Binary Manager
 *
 * Handles locating and managing Verible binary executables.
 * Supports auto-download, bundled binaries, system PATH, and environment variable overrides.
 *
 * @module verible/binary-manager
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
 * Verible binary names.
 */
export type VeribleBinary = 'verible-verilog-syntax' | 'verible-verilog-lint' | 'verible-verilog-format';

/**
 * Binary location result.
 */
interface BinaryLocation {
  /** Path to the binary */
  path: string;

  /** How the binary was found */
  source: 'bundled' | 'env' | 'path' | 'system' | 'downloaded';

  /** Verible version (if detectable) */
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
const BUNDLED_DIR = join(__dirname, '..', '..', '..', 'binaries');

/**
 * Directory where downloaded binaries are cached.
 */
const CACHE_DIR = join(homedir(), '.gateflow', 'verible');

/**
 * Environment variable for custom Verible path.
 */
const VERIBLE_PATH_ENV = 'VERIBLE_PATH';

/**
 * GitHub API URL for latest release.
 */
const GITHUB_RELEASES_API = 'https://api.github.com/repos/chipsalliance/verible/releases/latest';

/**
 * Binary extensions by platform.
 */
const BINARY_EXTENSION: Record<Platform, string> = {
  win32: '.exe',
  darwin: '',
  linux: '',
};

/**
 * Platform identifiers in Verible release filenames.
 */
const RELEASE_PLATFORM_MAP: Record<Platform, string[]> = {
  win32: ['win64'],
  darwin: ['macOS', 'darwin'],
  linux: ['linux-static-x86_64', 'linux'],
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
 * Manages Verible binary discovery and execution.
 */
class VeribleBinaryManager {
  private cachedPaths: Map<VeribleBinary, BinaryLocation> = new Map();
  private readonly platform: Platform;
  private readonly arch: Architecture;
  private downloadInProgress: Promise<string> | null = null;

  constructor() {
    this.platform = platform() as Platform;
    this.arch = arch() as Architecture;
  }

  /**
   * Find a Verible binary.
   *
   * Search order:
   * 1. VERIBLE_PATH environment variable
   * 2. Downloaded binaries (cache)
   * 3. Bundled binaries
   * 4. System PATH
   * 5. Auto-download (if autoDownload is true)
   *
   * @param binary - Which Verible binary to find
   * @param autoDownload - Whether to auto-download if not found (default: true)
   * @param onProgress - Optional progress callback for downloads
   * @returns Binary location info
   * @throws Error if binary not found and download fails/disabled
   */
  async findBinary(
    binary: VeribleBinary,
    autoDownload = true,
    onProgress?: DownloadProgressCallback
  ): Promise<BinaryLocation> {
    // Check cache first
    const cached = this.cachedPaths.get(binary);
    if (cached) {
      return cached;
    }

    // Try each source in order
    let location =
      (await this.tryEnvPath(binary)) ||
      (await this.tryDownloadedPath(binary)) ||
      (await this.tryBundledPath(binary)) ||
      (await this.trySystemPath(binary));

    // If not found and auto-download enabled, try downloading
    if (!location && autoDownload) {
      try {
        await this.downloadVerible(onProgress);
        location = await this.tryDownloadedPath(binary);
      } catch (err) {
        // Download failed, will throw below
      }
    }

    if (!location) {
      throw new Error(
        `Verible binary '${binary}' not found. ` +
          `Install Verible or set ${VERIBLE_PATH_ENV} environment variable. ` +
          `See: https://github.com/chipsalliance/verible`
      );
    }

    // Cache and return
    this.cachedPaths.set(binary, location);
    return location;
  }

  /**
   * Check if a Verible binary is available.
   *
   * @param binary - Which binary to check
   * @param autoDownload - Whether to try auto-download (default: false for checks)
   * @returns true if available
   */
  async isAvailable(binary: VeribleBinary, autoDownload = false): Promise<boolean> {
    try {
      await this.findBinary(binary, autoDownload);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download Verible binaries from GitHub releases.
   *
   * @param onProgress - Optional progress callback
   * @returns Path to downloaded binaries directory
   */
  async downloadVerible(onProgress?: DownloadProgressCallback): Promise<string> {
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
   * Get all available Verible binaries.
   *
   * @returns Map of binary name to location
   */
  async getAvailableBinaries(): Promise<Map<VeribleBinary, BinaryLocation>> {
    const binaries: VeribleBinary[] = [
      'verible-verilog-syntax',
      'verible-verilog-lint',
      'verible-verilog-format',
    ];

    const available = new Map<VeribleBinary, BinaryLocation>();

    for (const binary of binaries) {
      try {
        const location = await this.findBinary(binary, false);
        available.set(binary, location);
      } catch {
        // Binary not available, skip
      }
    }

    return available;
  }

  /**
   * Get Verible version from any available binary.
   *
   * @returns Version string or undefined
   */
  async getVersion(): Promise<string | undefined> {
    try {
      const location = await this.findBinary('verible-verilog-syntax', false);
      return this.detectVersion(location.path);
    } catch {
      return undefined;
    }
  }

  /**
   * Clear the binary path cache.
   */
  clearCache(): void {
    this.cachedPaths.clear();
  }

  /**
   * Remove downloaded Verible binaries.
   */
  async clearDownloads(): Promise<void> {
    if (existsSync(CACHE_DIR)) {
      await rm(CACHE_DIR, { recursive: true, force: true });
    }
    this.clearCache();
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

    report('fetching', 'Fetching latest Verible release info...');

    // Get latest release info from GitHub
    const releaseInfo = await this.fetchReleaseInfo();
    const assetUrl = this.findAssetUrl(releaseInfo);

    if (!assetUrl) {
      throw new Error(`No Verible release found for platform: ${this.platform}-${this.arch}`);
    }

    // Create cache directory
    await mkdir(CACHE_DIR, { recursive: true });

    const archiveExt = ARCHIVE_EXTENSION[this.platform];
    const archivePath = join(CACHE_DIR, `verible${archiveExt}`);

    report('downloading', `Downloading Verible from ${assetUrl}...`);

    // Download the archive
    await this.downloadFile(assetUrl, archivePath, (percent) => {
      report('downloading', `Downloading Verible... ${percent}%`, percent);
    });

    report('extracting', 'Extracting Verible binaries...');

    // Extract the archive
    await this.extractArchive(archivePath, CACHE_DIR);

    // Clean up archive
    await rm(archivePath, { force: true });

    // Find the bin directory (Verible extracts to a versioned folder)
    const binDir = await this.findBinDirectory(CACHE_DIR);

    report('done', `Verible installed to ${binDir}`);

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
    const archiveExt = ARCHIVE_EXTENSION[this.platform];

    for (const asset of assets) {
      const name = asset.name as string;

      // Check if this asset matches our platform
      const matchesPlatform = platformKeys.some((key) => name.includes(key));
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
      await execPromise(
        `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`
      );
    } else {
      // Use tar for tar.gz on Unix
      await tarExtract({
        file: archivePath,
        cwd: destDir,
      });
    }

    // Make binaries executable on Unix
    if (this.platform !== 'win32') {
      const binDir = await this.findBinDirectory(destDir);
      const binaries: VeribleBinary[] = [
        'verible-verilog-syntax',
        'verible-verilog-lint',
        'verible-verilog-format',
      ];

      for (const binary of binaries) {
        const binaryPath = join(binDir, binary);
        if (existsSync(binaryPath)) {
          await chmod(binaryPath, 0o755);
        }
      }
    }
  }

  /**
   * Find the bin directory inside extracted archive.
   * Verible extracts to a versioned folder like 'verible-v0.0-1234-gabcdef/bin'
   */
  private async findBinDirectory(baseDir: string): Promise<string> {
    const entries = await readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('verible')) {
        const binPath = join(baseDir, entry.name, 'bin');
        if (existsSync(binPath)) {
          return binPath;
        }
        // Some releases have binaries directly in the folder
        const directPath = join(baseDir, entry.name);
        const syntaxPath = join(directPath, this.getBinaryName('verible-verilog-syntax'));
        if (existsSync(syntaxPath)) {
          return directPath;
        }
      }
    }

    // Check if binaries are directly in cache dir
    const syntaxPath = join(baseDir, this.getBinaryName('verible-verilog-syntax'));
    if (existsSync(syntaxPath)) {
      return baseDir;
    }

    throw new Error('Could not find Verible binaries in extracted archive');
  }

  // ---------------------------------------------------------------------------
  // Path Resolution Methods
  // ---------------------------------------------------------------------------

  /**
   * Try to find binary from VERIBLE_PATH environment variable.
   */
  private async tryEnvPath(binary: VeribleBinary): Promise<BinaryLocation | null> {
    const envPath = process.env[VERIBLE_PATH_ENV];
    if (!envPath) {
      return null;
    }

    const binaryPath = join(envPath, this.getBinaryName(binary));
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
  private async tryDownloadedPath(binary: VeribleBinary): Promise<BinaryLocation | null> {
    if (!existsSync(CACHE_DIR)) {
      return null;
    }

    try {
      const binDir = await this.findBinDirectory(CACHE_DIR);
      const binaryPath = join(binDir, this.getBinaryName(binary));

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
  private async tryBundledPath(binary: VeribleBinary): Promise<BinaryLocation | null> {
    const platformDir = this.getPlatformDir();
    const binaryPath = join(BUNDLED_DIR, platformDir, this.getBinaryName(binary));

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
  private async trySystemPath(binary: VeribleBinary): Promise<BinaryLocation | null> {
    try {
      const binaryName = this.getBinaryName(binary);

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
  private getBinaryName(binary: VeribleBinary): string {
    const ext = BINARY_EXTENSION[this.platform] || '';
    return binary + ext;
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
   * Detect Verible version from binary.
   */
  private detectVersion(binaryPath: string): string | undefined {
    try {
      const result = execSync(`"${binaryPath}" --version`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 5000,
      });

      // Parse version from output (format varies)
      const match = result.match(/v?(\d+\.\d+(?:\.\d+)?(?:-\d+-g[a-f0-9]+)?)/);
      return match?.[1];
    } catch {
      return undefined;
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Default binary manager instance.
 */
export const binaryManager = new VeribleBinaryManager();

/**
 * Find a Verible binary (convenience function).
 */
export async function findVeribleBinary(
  binary: VeribleBinary,
  autoDownload = true
): Promise<BinaryLocation> {
  return binaryManager.findBinary(binary, autoDownload);
}

/**
 * Check if Verible is available (convenience function).
 */
export async function isVeribleAvailable(autoDownload = false): Promise<boolean> {
  return binaryManager.isAvailable('verible-verilog-syntax', autoDownload);
}

/**
 * Download Verible binaries (convenience function).
 */
async function downloadVerible(onProgress?: DownloadProgressCallback): Promise<string> {
  return binaryManager.downloadVerible(onProgress);
}
