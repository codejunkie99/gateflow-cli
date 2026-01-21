/**
 * Setup Module
 *
 * Provides deterministic, secure tool setup for GateFlow.
 *
 * Features:
 * - SHA-256 checksum verification
 * - User consent management
 * - Cross-platform support
 * - Progress reporting
 * - Caching
 *
 * @module setup
 */

// Core setup flow
export {
  runSetup,
  areToolsReady,
  promptSetupIfNeeded,
  type SetupOptions,
  type SetupResult,
} from './setup.js';

// Download manager
export {
  downloadTool,
  getToolsStatus,
  clearCache,
  getCacheDir,
  getToolsDir,
  type DownloadProgress,
  type DownloadResult,
} from './download-manager.js';

// Manifest
export {
  TOOL_MANIFEST,
  getToolAsset,
  getToolDefinition,
  isToolAvailableForPlatform,
  formatSize,
  getCurrentPlatformKey,
  type ToolManifest,
  type ToolDefinition,
  type ToolAsset,
  type Platform,
  type Architecture,
} from './manifest.js';

// Preferences
export {
  loadPreferences,
  savePreferences,
  updatePreference,
  markToolInstalled,
  resetPreferences,
  getPreferencesPath,
  getGateflowDir,
  type SetupPreferences,
  type DownloadConsent,
} from './preferences.js';

// Checksum verification
export {
  computeSHA256,
  verifySHA256,
  isValidSHA256,
  isChecksumPlaceholder,
  formatChecksumError,
  CHECKSUM_PLACEHOLDER,
  type ChecksumResult,
  type VerificationResult,
} from './checksum.js';
