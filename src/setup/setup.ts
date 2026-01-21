/**
 * Setup Flow
 *
 * Provides a clean, deterministic setup experience for GateFlow tools.
 * Handles user consent, progress display, and error recovery.
 *
 * @module setup/setup
 */

import { stdin, stdout } from 'process';
import { createInterface } from 'readline';

import {
  TOOL_MANIFEST,
  getToolAsset,
  formatSize,
  getCurrentPlatformKey,
} from './manifest.js';
import {
  loadPreferences,
  savePreferences,
  type DownloadConsent,
  type SetupPreferences,
} from './preferences.js';
import {
  downloadTool,
  getToolsStatus,
  type DownloadProgress,
  type DownloadResult,
} from './download-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface SetupOptions {
  /** Tools to set up (default: both) */
  tools?: ('verible' | 'slang')[];
  /** Skip user prompts (use saved preferences) */
  nonInteractive?: boolean;
  /** Force re-download even if cached */
  force?: boolean;
  /** Quiet mode (minimal output) */
  quiet?: boolean;
}

export interface SetupResult {
  success: boolean;
  tools: {
    verible?: DownloadResult;
    slang?: DownloadResult;
  };
  skipped: ('verible' | 'slang')[];
}

// ============================================================================
// UI Helpers
// ============================================================================

function print(message: string, quiet = false): void {
  if (!quiet) {
    console.log(message);
  }
}

function printProgress(progress: DownloadProgress, quiet = false): void {
  if (quiet) return;

  const { phase, percent, message } = progress;
  const icon = {
    checking: '🔍',
    downloading: '📥',
    verifying: '🔒',
    extracting: '📦',
    complete: '✅',
    error: '❌',
  }[phase];

  if (percent !== undefined) {
    // Use carriage return for progress updates
    process.stdout.write(`\r${icon} ${message} ${percent}%   `);
    if (phase === 'complete' || phase === 'error') {
      console.log(); // Newline after completion
    }
  } else {
    console.log(`${icon} ${message}`);
  }
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptChoice(
  question: string,
  choices: string[]
): Promise<number> {
  console.log(`\n${question}`);
  choices.forEach((choice, i) => {
    console.log(`  ${i + 1}. ${choice}`);
  });

  while (true) {
    const answer = await prompt(`\nEnter choice (1-${choices.length}): `);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= choices.length) {
      return num - 1;
    }
    console.log('Invalid choice, please try again.');
  }
}

// ============================================================================
// Setup Banner
// ============================================================================

function printBanner(options: SetupOptions): void {
  if (options.quiet) return;

  const platformKey = getCurrentPlatformKey();

  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  GateFlow Tool Setup                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  GateFlow needs these tools for SystemVerilog analysis:     │
│                                                             │`);

  const tools = options.tools ?? ['verible', 'slang'];

  for (const tool of tools) {
    const def = TOOL_MANIFEST.tools[tool];
    const asset = getToolAsset(tool);
    const size = asset ? formatSize(asset.size) : 'N/A';
    const name = def.name.padEnd(10);
    const version = def.latest.version.substring(0, 15).padEnd(15);
    console.log(`│  • ${name} ${version}  (${size.padStart(8)})     │`);
  }

  console.log(`│                                                             │
│  Downloads are from GitHub and verified with SHA-256.       │
│  Platform: ${platformKey.padEnd(46)}│
│                                                             │
└─────────────────────────────────────────────────────────────┘
`);
}

// ============================================================================
// Main Setup Flow
// ============================================================================

/**
 * Run the interactive setup flow.
 */
export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const tools = options.tools ?? ['verible', 'slang'];
  const result: SetupResult = { success: true, tools: {}, skipped: [] };

  // Load preferences
  const prefs = await loadPreferences();

  // Check current status
  const status = await getToolsStatus();

  // Filter tools that need setup
  const toolsToSetup = tools.filter((tool) => {
    if (options.force) return true;
    return !status[tool].installed;
  });

  if (toolsToSetup.length === 0) {
    print('✅ All requested tools are already installed!', options.quiet);
    for (const tool of tools) {
      result.tools[tool] = {
        success: true,
        tool,
        version: status[tool].version ?? '',
        path: status[tool].path ?? '',
        cached: true,
      };
    }
    return result;
  }

  // Show banner
  printBanner({ ...options, tools: toolsToSetup });

  // Get consent
  const consent = await getConsent(prefs, toolsToSetup, options);

  if (consent === 'skip') {
    print('\n⏭️  Setup skipped. Run `gateflow setup` later to install tools.', options.quiet);
    result.skipped = toolsToSetup;
    return result;
  }

  // Download each tool
  print('', options.quiet);

  for (const tool of toolsToSetup) {
    const downloadResult = await downloadTool(tool, (progress) => {
      printProgress(progress, options.quiet);
    });

    result.tools[tool] = downloadResult;

    if (!downloadResult.success) {
      result.success = false;
      print(`\n❌ Failed to install ${tool}: ${downloadResult.error}`, options.quiet);

      // Ask about continuing
      if (!options.nonInteractive && toolsToSetup.indexOf(tool) < toolsToSetup.length - 1) {
        const continueChoice = await promptChoice(
          'Would you like to continue with other tools?',
          ['Yes, continue', 'No, stop setup']
        );
        if (continueChoice === 1) break;
      }
    }
  }

  // Summary
  printSummary(result, options.quiet);

  return result;
}

/**
 * Get user consent for downloads.
 */
async function getConsent(
  prefs: SetupPreferences,
  tools: ('verible' | 'slang')[],
  options: SetupOptions
): Promise<'proceed' | 'skip'> {
  // Non-interactive: use saved preference
  if (options.nonInteractive) {
    if (prefs.downloadConsent === 'never') {
      return 'skip';
    }
    return 'proceed';
  }

  // Already consented to always download
  if (prefs.downloadConsent === 'always') {
    print('ℹ️  Auto-downloading (your preference)', options.quiet);
    return 'proceed';
  }

  // Never consent
  if (prefs.downloadConsent === 'never') {
    print('ℹ️  Downloads disabled (your preference)', options.quiet);
    return 'skip';
  }

  // Ask user
  const choice = await promptChoice(
    'How would you like to proceed?',
    [
      'Download now',
      'Download now, and always auto-download in future',
      'Skip for now',
      'Never download automatically',
    ]
  );

  switch (choice) {
    case 0:
      return 'proceed';

    case 1:
      prefs.downloadConsent = 'always';
      await savePreferences(prefs);
      print('\n✅ Preference saved: auto-download enabled', options.quiet);
      return 'proceed';

    case 2:
      return 'skip';

    case 3:
      prefs.downloadConsent = 'never';
      await savePreferences(prefs);
      print('\n✅ Preference saved: auto-download disabled', options.quiet);
      return 'skip';

    default:
      return 'skip';
  }
}

/**
 * Print setup summary.
 */
function printSummary(result: SetupResult, quiet = false): void {
  if (quiet) return;

  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  Setup Summary                                              │');
  console.log('├─────────────────────────────────────────────────────────────┤');

  for (const [tool, downloadResult] of Object.entries(result.tools)) {
    if (!downloadResult) continue;

    const status = downloadResult.success
      ? downloadResult.cached
        ? '✅ Already installed'
        : '✅ Installed'
      : '❌ Failed';

    const version = downloadResult.version
      ? ` (${downloadResult.version})`
      : '';

    console.log(`│  ${tool.padEnd(10)} ${status}${version.padEnd(30)}│`);
  }

  for (const tool of result.skipped) {
    console.log(`│  ${tool.padEnd(10)} ⏭️  Skipped                            │`);
  }

  console.log('└─────────────────────────────────────────────────────────────┘');

  if (result.success && result.skipped.length === 0) {
    console.log('\n🎉 Setup complete! You can now use GateFlow for SystemVerilog development.\n');
  }
}

// ============================================================================
// Quick Check (for startup)
// ============================================================================

/**
 * Quick check if tools are available (for startup).
 * Returns true if all essential tools are installed.
 */
export async function areToolsReady(): Promise<boolean> {
  const status = await getToolsStatus();
  // At minimum, we need Verible for syntax parsing
  return status.verible.installed;
}

/**
 * Prompt setup if tools are missing (for first-run).
 */
export async function promptSetupIfNeeded(quiet = false): Promise<boolean> {
  const prefs = await loadPreferences();

  // Already prompted or tools installed
  if (prefs.hasSeenSetupPrompt) {
    return await areToolsReady();
  }

  const status = await getToolsStatus();

  if (!status.verible.installed || !status.slang.installed) {
    // First time - run setup
    const result = await runSetup({ quiet });

    // Mark as prompted
    prefs.hasSeenSetupPrompt = true;
    await savePreferences(prefs);

    return result.success;
  }

  return true;
}
