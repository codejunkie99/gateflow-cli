/**
 * Setup Preferences
 *
 * Manages user consent and preferences for tool downloads.
 * Stores preferences in ~/.gateflow/setup-preferences.json
 *
 * @module setup/preferences
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export type DownloadConsent = 'always' | 'ask' | 'never';

export interface SetupPreferences {
  /** Version for future migrations */
  version: 1;

  /** Global download consent preference */
  downloadConsent: DownloadConsent;

  /** Trusted domains for downloads (default: GitHub) */
  trustedDomains: string[];

  /** Whether to verify checksums (always true, but user can see it) */
  verifyChecksums: boolean;

  /** Tools that have been successfully set up */
  installedTools: {
    verible?: {
      version: string;
      installedAt: string;
      path: string;
    };
    slang?: {
      version: string;
      installedAt: string;
      path: string;
    };
  };

  /** Whether user has seen the first-run setup prompt */
  hasSeenSetupPrompt: boolean;

  /** Last time preferences were updated */
  updatedAt: string;
}

// ============================================================================
// Constants
// ============================================================================

const GATEFLOW_DIR = join(homedir(), '.gateflow');
const PREFERENCES_FILE = join(GATEFLOW_DIR, 'setup-preferences.json');

const DEFAULT_TRUSTED_DOMAINS = [
  'github.com',
  'githubusercontent.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
];

const DEFAULT_PREFERENCES: SetupPreferences = {
  version: 1,
  downloadConsent: 'ask',
  trustedDomains: DEFAULT_TRUSTED_DOMAINS,
  verifyChecksums: true,
  installedTools: {},
  hasSeenSetupPrompt: false,
  updatedAt: new Date().toISOString(),
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Ensure the .gateflow directory exists.
 */
async function ensureGateflowDir(): Promise<void> {
  if (!existsSync(GATEFLOW_DIR)) {
    await mkdir(GATEFLOW_DIR, { recursive: true });
  }
}

/**
 * Load user preferences from disk.
 * Returns defaults if file doesn't exist.
 */
export async function loadPreferences(): Promise<SetupPreferences> {
  try {
    await ensureGateflowDir();

    if (!existsSync(PREFERENCES_FILE)) {
      return { ...DEFAULT_PREFERENCES };
    }

    const content = await readFile(PREFERENCES_FILE, 'utf-8');
    const parsed = JSON.parse(content) as SetupPreferences;

    // Merge with defaults in case of new fields
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      trustedDomains: parsed.trustedDomains ?? DEFAULT_TRUSTED_DOMAINS,
      installedTools: parsed.installedTools ?? {},
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Save user preferences to disk.
 */
export async function savePreferences(
  prefs: SetupPreferences
): Promise<void> {
  await ensureGateflowDir();

  prefs.updatedAt = new Date().toISOString();
  await writeFile(PREFERENCES_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
}

/**
 * Update a specific preference field.
 */
export async function updatePreference<K extends keyof SetupPreferences>(
  key: K,
  value: SetupPreferences[K]
): Promise<SetupPreferences> {
  const prefs = await loadPreferences();
  prefs[key] = value;
  await savePreferences(prefs);
  return prefs;
}

/**
 * Mark a tool as installed.
 */
export async function markToolInstalled(
  tool: 'verible' | 'slang',
  version: string,
  path: string
): Promise<void> {
  const prefs = await loadPreferences();
  prefs.installedTools[tool] = {
    version,
    installedAt: new Date().toISOString(),
    path,
  };
  await savePreferences(prefs);
}

/**
 * Check if a domain is trusted for downloads.
 */
export function isDomainTrusted(
  url: string,
  trustedDomains: string[]
): boolean {
  try {
    const urlObj = new URL(url);
    return trustedDomains.some(
      (domain) =>
        urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Get display-friendly consent status.
 */
export function getConsentDisplay(consent: DownloadConsent): string {
  switch (consent) {
    case 'always':
      return 'Auto-download (trusted sources only)';
    case 'ask':
      return 'Ask before downloading';
    case 'never':
      return 'Never download (manual setup required)';
  }
}

/**
 * Reset preferences to defaults.
 */
export async function resetPreferences(): Promise<SetupPreferences> {
  const prefs = { ...DEFAULT_PREFERENCES };
  await savePreferences(prefs);
  return prefs;
}

/**
 * Export preferences path for user reference.
 */
export function getPreferencesPath(): string {
  return PREFERENCES_FILE;
}

/**
 * Export gateflow directory path.
 */
export function getGateflowDir(): string {
  return GATEFLOW_DIR;
}
