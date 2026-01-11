/**
 * Tool Setup Tools
 *
 * Zod schemas and executors for the ToolSetupAgent.
 * Handles detection and installation of Verible and Slang.
 *
 * @module agent/tool-setup-tools
 */

import { z } from 'zod';
import { execSync, spawn } from 'child_process';
import { platform, arch, homedir } from 'os';
import { existsSync } from 'fs';
import { appendFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { extract as tarExtract } from 'tar';
import type { EventBus } from '../events/index.js';
import type { SetupStage } from '../events/types.js';

// ============================================================================
// Zod Schemas (Tool Definitions)
// ============================================================================

export const checkSystemSchema = z.object({});

export const checkPrerequisitesSchema = z.object({});

export const checkToolStatusSchema = z.object({
  tool: z.enum(['slang', 'verible', 'both']).describe('Which tool(s) to check'),
});

export const runCommandSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  description: z.string().describe('Human-readable description of what this does'),
  workingDir: z.string().optional().describe('Working directory for command'),
  timeout: z.number().optional().default(600000).describe('Timeout in ms (default: 10 min)'),
});

export const downloadFileSchema = z.object({
  url: z.string().url().describe('URL to download from'),
  destination: z.string().describe('Local path to save file'),
  description: z.string().describe('What is being downloaded'),
});

export const extractArchiveSchema = z.object({
  archivePath: z.string().describe('Path to archive file (.zip or .tar.gz)'),
  destination: z.string().describe('Directory to extract to'),
  description: z.string().describe('What is being extracted'),
});

export const setEnvVarSchema = z.object({
  name: z.string().describe('Environment variable name'),
  value: z.string().describe('Environment variable value'),
  envFile: z.string().optional().default('.env').describe('Path to .env file'),
});

export const verifyVeribleSchema = z.object({
  path: z.string().optional().describe('Path to verible binaries (uses VERIBLE_PATH if not provided)'),
});

export const verifySlangSchema = z.object({
  path: z.string().optional().describe('Path to slang binary (uses SLANG_PATH if not provided)'),
});

export const getLatestReleaseSchema = z.object({
  tool: z.enum(['slang', 'verible']).describe('Which tool to get release info for'),
});

export const askUserSchema = z.object({
  question: z.string().describe('Question to ask the user'),
  options: z.array(z.string()).optional().describe('Optional list of choices for the user'),
  default: z.string().optional().describe('Default option if user just presses enter'),
});

// ============================================================================
// Constants
// ============================================================================

const GITHUB_RELEASES = {
  verible: 'https://api.github.com/repos/chipsalliance/verible/releases/latest',
  slang: 'https://api.github.com/repos/MikePopoloski/slang/releases/latest',
};

// ============================================================================
// Helper Functions
// ============================================================================

function emitStage(
  bus: EventBus,
  tool: 'verible' | 'slang',
  stage: SetupStage,
  status: 'started' | 'completed' | 'failed',
  message?: string
) {
  bus.emit({
    type: 'setup_stage',
    tool,
    stage,
    status,
    message,
  });
}

/**
 * Infer which tool is being operated on from description or URL.
 */
function inferTool(description: string, url?: string): 'verible' | 'slang' {
  const text = `${description} ${url || ''}`.toLowerCase();
  if (text.includes('verible') || text.includes('chipsalliance')) {
    return 'verible';
  }
  if (text.includes('slang') || text.includes('mikepopoloski')) {
    return 'slang';
  }
  // Default to verible if we can't determine
  return 'verible';
}

/**
 * Infer the setup stage from a command string.
 */
function inferStageFromCommand(command: string, description: string): SetupStage {
  const text = `${command} ${description}`.toLowerCase();

  if (text.includes('git clone')) {
    return 'cloning';
  }
  if (text.includes('cmake') && (text.includes('-b') || text.includes('configure'))) {
    return 'configuring';
  }
  if (text.includes('cmake') && text.includes('--build')) {
    return 'building';
  }
  if (text.includes('link')) {
    return 'linking';
  }
  if (text.includes('verify') || text.includes('--version')) {
    return 'verifying';
  }

  // Default to checking for other commands
  return 'checking';
}

// ============================================================================
// Tool Executors
// ============================================================================

export function createToolSetupExecutors(bus: EventBus, projectRoot: string) {
  return {
    check_system: async () => {
      const os = platform();
      const architecture = arch();

      // Detect compilers
      const compilers: Record<string, string | null> = {};

      if (os === 'win32') {
        try {
          const vsWhere = execSync(
            '"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -property installationVersion',
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
          ).trim();
          compilers.msvc = vsWhere || null;
        } catch {
          compilers.msvc = null;
        }
      }

      try {
        compilers.gcc = execSync('g++ --version', { encoding: 'utf-8' }).split('\n')[0];
      } catch {
        compilers.gcc = null;
      }

      try {
        compilers.clang = execSync('clang++ --version', { encoding: 'utf-8' }).split('\n')[0];
      } catch {
        compilers.clang = null;
      }

      return { platform: os, arch: architecture, compilers };
    },

    check_tool_status: async (args: z.infer<typeof checkToolStatusSchema>) => {
      const status: Record<string, { available: boolean; version?: string; path?: string }> = {};

      if (args.tool === 'verible' || args.tool === 'both') {
        try {
          const { binaryManager: veribleBinaryManager } = await import('../indexer/verible/binary-manager.js');
          const available = await veribleBinaryManager.isAvailable('verible-verilog-syntax');
          if (available) {
            const loc = await veribleBinaryManager.findBinary('verible-verilog-syntax', false);
            status.verible = { available: true, version: loc.version, path: loc.path };
          } else {
            status.verible = { available: false };
          }
        } catch {
          status.verible = { available: false };
        }
      }

      if (args.tool === 'slang' || args.tool === 'both') {
        try {
          const { slangBinaryManager } = await import('../indexer/slang/binary-manager.js');
          const available = await slangBinaryManager.isAvailable();
          if (available) {
            const loc = await slangBinaryManager.findBinary(false);
            status.slang = { available: true, version: loc.version, path: loc.path };
          } else {
            status.slang = { available: false };
          }
        } catch {
          status.slang = { available: false };
        }
      }

      return status;
    },

    get_latest_release: async (args: z.infer<typeof getLatestReleaseSchema>) => {
      const url = GITHUB_RELEASES[args.tool];
      const response = await fetch(url, {
        headers: { 'User-Agent': 'gateflow-cli' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch release: ${response.status}`);
      }

      const release = await response.json();
      const os = platform();

      // Find matching asset
      const assets = release.assets || [];
      let matchingAsset = null;

      for (const asset of assets) {
        const name = asset.name.toLowerCase();
        const isMatch =
          (os === 'win32' && name.includes('win')) ||
          (os === 'darwin' && (name.includes('macos') || name.includes('darwin'))) ||
          (os === 'linux' && name.includes('linux'));
        if (isMatch && (name.endsWith('.zip') || name.endsWith('.tar.gz'))) {
          matchingAsset = asset;
          break;
        }
      }

      return {
        version: release.tag_name,
        hasPrebuiltBinaries: assets.length > 0,
        downloadUrl: matchingAsset?.browser_download_url,
        assetName: matchingAsset?.name,
        releaseNotes: release.body?.substring(0, 500),
      };
    },

    check_prerequisites: async () => {
      const results: Record<string, { found: boolean; version?: string }> = {};

      // Check git
      try {
        const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
        results.git = { found: true, version: gitVersion };
      } catch {
        results.git = { found: false };
      }

      // Check cmake
      try {
        const cmakeOutput = execSync('cmake --version', { encoding: 'utf-8' });
        const version = cmakeOutput.match(/cmake version ([\d.]+)/)?.[1];
        results.cmake = { found: true, version };
      } catch {
        results.cmake = { found: false };
      }

      // Check for C++20 compiler
      const os = platform();
      if (os === 'win32') {
        try {
          execSync('cl', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
          results.cpp20_compiler = { found: true, version: 'MSVC' };
        } catch {
          results.cpp20_compiler = { found: false };
        }
      } else {
        try {
          execSync('g++ -std=c++20 --version', { encoding: 'utf-8' });
          results.cpp20_compiler = { found: true, version: 'g++' };
        } catch {
          try {
            execSync('clang++ -std=c++20 --version', { encoding: 'utf-8' });
            results.cpp20_compiler = { found: true, version: 'clang++' };
          } catch {
            results.cpp20_compiler = { found: false };
          }
        }
      }

      return results;
    },

    extract_archive: async (args: z.infer<typeof extractArchiveSchema>) => {
      const tool = inferTool(args.description, args.archivePath);

      emitStage(bus, tool, 'extracting', 'started', args.description);
      bus.emit({ type: 'status', phase: 'extracting', label: args.description });

      try {
        await mkdir(args.destination, { recursive: true });

        if (args.archivePath.endsWith('.zip')) {
          // Use PowerShell on Windows
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
                  args.archivePath,
                  '-DestinationPath',
                  args.destination,
                  '-Force',
                ],
                { stdio: 'pipe' }
              );
              proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
              proc.on('error', reject);
            });
          } else {
            execSync(`unzip -o "${args.archivePath}" -d "${args.destination}"`);
          }
        } else if (args.archivePath.endsWith('.tar.gz')) {
          await tarExtract({ file: args.archivePath, cwd: args.destination });
        }

        emitStage(bus, tool, 'extracting', 'completed');
        return { success: true, destination: args.destination };
      } catch (err) {
        emitStage(bus, tool, 'extracting', 'failed', String(err));
        throw err;
      }
    },

    verify_verible: async (args: z.infer<typeof verifyVeribleSchema>) => {
      emitStage(bus, 'verible', 'verifying', 'started', 'Verifying Verible installation');

      const veriblePath = args.path || process.env.VERIBLE_PATH;
      const binaryName = platform() === 'win32' ? 'verible-verilog-syntax.exe' : 'verible-verilog-syntax';

      if (!veriblePath) {
        emitStage(bus, 'verible', 'verifying', 'failed', 'No path provided');
        return { working: false, error: 'No path provided or VERIBLE_PATH not set' };
      }

      const binaryPath = join(veriblePath, binaryName);
      if (!existsSync(binaryPath)) {
        emitStage(bus, 'verible', 'verifying', 'failed', 'Binary not found');
        return { working: false, error: `Binary not found at ${binaryPath}` };
      }

      try {
        const version = execSync(`"${binaryPath}" --version`, { encoding: 'utf-8' });
        emitStage(bus, 'verible', 'verifying', 'completed', `Version ${version.trim()}`);
        return { working: true, version: version.trim(), path: binaryPath };
      } catch (err) {
        emitStage(bus, 'verible', 'verifying', 'failed', String(err));
        return { working: false, error: `Failed to run verible: ${err}` };
      }
    },

    run_command: async (args: z.infer<typeof runCommandSchema>) => {
      const tool = inferTool(args.description, args.command);
      const stage = inferStageFromCommand(args.command, args.description);

      emitStage(bus, tool, stage, 'started', args.description);

      return new Promise((resolve, reject) => {
        const cwd = args.workingDir || projectRoot;
        const timeout = args.timeout || 600000;

        bus.emit({ type: 'status', phase: 'executing', label: args.description });

        const proc = spawn(args.command, [], {
          shell: true,
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          // Stream output via event bus
          bus.emit({ type: 'token', text: `[cmd] ${text}` });
        });

        proc.stderr.on('data', (data) => {
          const text = data.toString();
          stderr += text;
          bus.emit({ type: 'token', text: `[err] ${text}` });
        });

        const timeoutHandle = setTimeout(() => {
          proc.kill('SIGTERM');
          emitStage(bus, tool, stage, 'failed', 'Command timed out');
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);

        proc.on('close', (code) => {
          clearTimeout(timeoutHandle);
          if (code === 0) {
            emitStage(bus, tool, stage, 'completed');
            resolve({ success: true, stdout, stderr, exitCode: code });
          } else {
            emitStage(bus, tool, stage, 'failed', `Exit code ${code}`);
            resolve({ success: false, stdout, stderr, exitCode: code });
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timeoutHandle);
          emitStage(bus, tool, stage, 'failed', String(err));
          reject(err);
        });
      });
    },

    download_file: async (args: z.infer<typeof downloadFileSchema>) => {
      // Infer tool from description or URL
      const tool = inferTool(args.description, args.url);

      emitStage(bus, tool, 'downloading', 'started', args.description);
      bus.emit({ type: 'status', phase: 'downloading', label: args.description });

      try {
        const response = await fetch(args.url);
        if (!response.ok) {
          emitStage(bus, tool, 'downloading', 'failed', `HTTP ${response.status}`);
          throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const chunks: Uint8Array[] = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;

          if (contentLength > 0) {
            const percent = Math.round((received / contentLength) * 100);
            bus.emit({ type: 'token', text: `\rDownloading: ${percent}%` });
          }
        }

        const buffer = Buffer.concat(chunks);
        await writeFile(args.destination, buffer);

        emitStage(bus, tool, 'downloading', 'completed');
        return { success: true, path: args.destination, bytes: received };
      } catch (err) {
        emitStage(bus, tool, 'downloading', 'failed', String(err));
        throw err;
      }
    },

    set_env_var: async (args: z.infer<typeof setEnvVarSchema>) => {
      // Infer tool from variable name
      const tool = args.name.toLowerCase().includes('verible') ? 'verible' : 'slang';

      emitStage(bus, tool, 'saving', 'started', `Saving ${args.name} to .env`);

      try {
        const envFile = args.envFile || '.env';
        const envPath = join(projectRoot, envFile);
        const line = `\n${args.name}=${args.value}\n`;

        await appendFile(envPath, line);
        process.env[args.name] = args.value;

        emitStage(bus, tool, 'saving', 'completed');
        return { success: true, file: envPath, variable: args.name };
      } catch (err) {
        emitStage(bus, tool, 'saving', 'failed', String(err));
        throw err;
      }
    },

    verify_slang: async (args: z.infer<typeof verifySlangSchema>) => {
      emitStage(bus, 'slang', 'verifying', 'started', 'Verifying Slang installation');

      const slangPath = args.path || process.env.SLANG_PATH;

      if (!slangPath) {
        emitStage(bus, 'slang', 'verifying', 'failed', 'No path provided');
        return { working: false, error: 'No slang path provided or SLANG_PATH not set' };
      }

      const binaryName = platform() === 'win32' ? 'slang.exe' : 'slang';
      const binaryPath = slangPath.endsWith(binaryName) ? slangPath : join(slangPath, binaryName);

      if (!existsSync(binaryPath)) {
        emitStage(bus, 'slang', 'verifying', 'failed', 'Binary not found');
        return { working: false, error: `Binary not found at ${binaryPath}` };
      }

      try {
        const version = execSync(`"${binaryPath}" --version`, { encoding: 'utf-8' });
        const match = version.match(/(\d+\.\d+(?:\.\d+)?)/);
        emitStage(bus, 'slang', 'verifying', 'completed', `Version ${match?.[1]}`);
        return { working: true, version: match?.[1], path: binaryPath };
      } catch (err) {
        emitStage(bus, 'slang', 'verifying', 'failed', String(err));
        return { working: false, error: `Failed to run slang: ${err}` };
      }
    },

    ask_user: async (args: z.infer<typeof askUserSchema>) => {
      const readline = await import('readline');

      return new Promise((resolve) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        let prompt = `\n${args.question}`;
        if (args.options && args.options.length > 0) {
          prompt += `\n  Options: ${args.options.join(' / ')}`;
        }
        if (args.default) {
          prompt += ` [${args.default}]`;
        }
        prompt += '\n> ';

        // Emit event so renderer knows we're waiting for input
        bus.emit({
          type: 'status',
          phase: 'tool',
          label: 'Waiting for user input...',
        });

        rl.question(prompt, (answer) => {
          rl.close();
          const response = answer.trim() || args.default || '';

          // Normalize yes/no responses
          const normalized = response.toLowerCase();
          const isYes = ['y', 'yes', 'yeah', 'yep', 'ok', 'sure', '1'].includes(normalized);
          const isNo = ['n', 'no', 'nope', 'nah', '0'].includes(normalized);

          resolve({
            response,
            isYes,
            isNo,
            selectedOption: args.options?.find(
              (o) => o.toLowerCase() === normalized || o.toLowerCase().startsWith(normalized)
            ),
          });
        });
      });
    },
  };
}

// ============================================================================
// Tool Descriptions (for AI SDK)
// ============================================================================

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  check_system: 'Detect operating system, architecture, and available compilers',
  check_tool_status: 'Check if Slang and/or Verible are installed and available',
  check_prerequisites: 'Check if git, cmake, and C++20 compiler are available for building Slang',
  get_latest_release: 'Get latest GitHub release info including download URL for a tool',
  run_command: 'Run a shell command (requires user approval)',
  download_file: 'Download a file from URL (requires user approval)',
  extract_archive: 'Extract a .zip or .tar.gz archive (requires user approval)',
  set_env_var: 'Set environment variable in .env file (requires user approval)',
  verify_verible: 'Verify Verible is working correctly',
  verify_slang: 'Verify Slang is working correctly',
  ask_user: 'Ask the user a question and wait for their response. Use for confirmations and choices.',
};

export const TOOL_SCHEMAS: Record<string, z.ZodObject<any>> = {
  check_system: checkSystemSchema,
  check_tool_status: checkToolStatusSchema,
  check_prerequisites: checkPrerequisitesSchema,
  get_latest_release: getLatestReleaseSchema,
  run_command: runCommandSchema,
  download_file: downloadFileSchema,
  extract_archive: extractArchiveSchema,
  set_env_var: setEnvVarSchema,
  verify_verible: verifyVeribleSchema,
  verify_slang: verifySlangSchema,
  ask_user: askUserSchema,
};
