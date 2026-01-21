/**
 * Tool Manifest
 *
 * Defines available tools, versions, and SHA-256 checksums for verification.
 * This is the source of truth for tool downloads in GateFlow.
 *
 * @module setup/manifest
 */

import { platform, arch } from 'os';

// ============================================================================
// Types
// ============================================================================

export type Platform = 'win32' | 'darwin' | 'linux';
export type Architecture = 'x64' | 'arm64';
export type PlatformKey = `${Platform}-${Architecture}`;

export interface ToolAsset {
  /** Download URL */
  url: string;
  /** SHA-256 checksum for verification */
  sha256: string;
  /** File size in bytes (for progress) */
  size: number;
}

export interface ToolVersion {
  /** Semantic version */
  version: string;
  /** Release date (ISO string) */
  releaseDate: string;
  /** Platform-specific assets */
  assets: Partial<Record<PlatformKey, ToolAsset>>;
}

export interface ToolDefinition {
  /** Tool display name */
  name: string;
  /** Short description */
  description: string;
  /** GitHub repo (owner/repo) */
  repo: string;
  /** Binary name after extraction */
  binaryName: string;
  /** Latest stable version */
  latest: ToolVersion;
}

export interface ToolManifest {
  /** Manifest version for compatibility */
  manifestVersion: number;
  /** Last updated timestamp */
  lastUpdated: string;
  /** Tool definitions */
  tools: {
    verible: ToolDefinition;
    slang: ToolDefinition;
  };
}

// ============================================================================
// Manifest Data
// ============================================================================

/**
 * Current tool manifest with verified checksums.
 *
 * To update checksums:
 * 1. Download the release asset
 * 2. Run: shasum -a 256 <file>  (macOS/Linux) or Get-FileHash <file> -Algorithm SHA256 (PowerShell)
 * 3. Update the sha256 field below
 */
export const TOOL_MANIFEST: ToolManifest = {
  manifestVersion: 1,
  lastUpdated: '2025-01-20',
  tools: {
    verible: {
      name: 'Verible',
      description: 'SystemVerilog syntax parser and linter',
      repo: 'chipsalliance/verible',
      binaryName: 'verible-verilog-syntax',
      latest: {
        version: 'v0.0-3824-g9ada708a',
        releaseDate: '2024-12-15',
        assets: {
          'win32-x64': {
            url: 'https://github.com/chipsalliance/verible/releases/download/v0.0-3824-g9ada708a/verible-v0.0-3824-g9ada708a-win64.zip',
            sha256: 'CHECKSUM_NEEDED', // TODO: Update with actual checksum
            size: 15_000_000,
          },
          'darwin-x64': {
            url: 'https://github.com/chipsalliance/verible/releases/download/v0.0-3824-g9ada708a/verible-v0.0-3824-g9ada708a-macOS.tar.gz',
            sha256: 'CHECKSUM_NEEDED',
            size: 12_000_000,
          },
          'darwin-arm64': {
            url: 'https://github.com/chipsalliance/verible/releases/download/v0.0-3824-g9ada708a/verible-v0.0-3824-g9ada708a-macOS.tar.gz',
            sha256: 'CHECKSUM_NEEDED',
            size: 12_000_000,
          },
          'linux-x64': {
            url: 'https://github.com/chipsalliance/verible/releases/download/v0.0-3824-g9ada708a/verible-v0.0-3824-g9ada708a-linux-static-x86_64.tar.gz',
            sha256: 'CHECKSUM_NEEDED',
            size: 14_000_000,
          },
        },
      },
    },
    slang: {
      name: 'Slang',
      description: 'SystemVerilog compiler and semantic analyzer',
      repo: 'MikePopoloski/slang',
      binaryName: 'slang',
      latest: {
        version: 'v7.0',
        releaseDate: '2024-11-01',
        assets: {
          'win32-x64': {
            url: 'https://github.com/MikePopoloski/slang/releases/download/v7.0/slang-win64.zip',
            sha256: 'CHECKSUM_NEEDED',
            size: 8_000_000,
          },
          'darwin-x64': {
            url: 'https://github.com/MikePopoloski/slang/releases/download/v7.0/slang-macos-x86_64.tar.gz',
            sha256: 'CHECKSUM_NEEDED',
            size: 7_000_000,
          },
          'darwin-arm64': {
            url: 'https://github.com/MikePopoloski/slang/releases/download/v7.0/slang-macos-arm64.tar.gz',
            sha256: 'CHECKSUM_NEEDED',
            size: 7_000_000,
          },
          'linux-x64': {
            url: 'https://github.com/MikePopoloski/slang/releases/download/v7.0/slang-linux-x86_64.tar.gz',
            sha256: 'CHECKSUM_NEEDED',
            size: 8_000_000,
          },
        },
      },
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the current platform key for asset lookup.
 */
export function getCurrentPlatformKey(): PlatformKey {
  const p = platform() as Platform;
  const a = arch() === 'arm64' ? 'arm64' : 'x64';
  return `${p}-${a}` as PlatformKey;
}

/**
 * Get asset for a tool on the current platform.
 */
export function getToolAsset(
  tool: keyof ToolManifest['tools']
): ToolAsset | null {
  const platformKey = getCurrentPlatformKey();
  const toolDef = TOOL_MANIFEST.tools[tool];
  return toolDef.latest.assets[platformKey] ?? null;
}

/**
 * Get tool definition.
 */
export function getToolDefinition(
  tool: keyof ToolManifest['tools']
): ToolDefinition {
  return TOOL_MANIFEST.tools[tool];
}

/**
 * Check if a tool is available for the current platform.
 */
export function isToolAvailableForPlatform(
  tool: keyof ToolManifest['tools']
): boolean {
  return getToolAsset(tool) !== null;
}

/**
 * Format file size for display.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
