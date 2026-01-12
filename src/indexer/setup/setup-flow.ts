/**
 * Tool Setup Flow
 *
 * Entry point for interactive tool setup using Vercel AI SDK.
 * Helps users set up Verible and Slang with streaming and human-in-the-loop approval.
 *
 * @module indexer/setup/setup-flow
 */

import { streamText, tool, zodSchema } from 'ai';

// Message type for conversation history
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
import { anthropic } from '@ai-sdk/anthropic';
import type { EventBus } from '../../events/index.js';
import type { PolicyEngine } from '../../approval/index.js';
import type { ToolName } from '../../approval/types.js';
import { TOOL_SETUP_SYSTEM_PROMPT } from '../../agent/workers/ToolSetupAgent.js';
import {
  createToolSetupExecutors,
  TOOL_DESCRIPTIONS,
  TOOL_SCHEMAS,
} from '../../agent/tool-setup-tools.js';
import { slangBinaryManager } from '../slang/binary-manager.js';
import { binaryManager as veribleBinaryManager } from '../verible/binary-manager.js';
import { getInputManager } from '../../ui/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolSetupResult {
  success: boolean;
  tools: {
    verible?: {
      action: 'installed' | 'existing' | 'skipped' | 'failed';
      path?: string;
      version?: string;
    };
    slang?: {
      action: 'built' | 'existing' | 'skipped' | 'failed';
      path?: string;
      version?: string;
    };
  };
  error?: string;
}

export interface ToolSetupOptions {
  /** Whether to run in interactive mode (default: true) */
  interactive?: boolean;
  /** Which tools to set up (default: both) */
  tools?: ('verible' | 'slang')[];
  /** Model to use for the agent */
  model?: string;
}

// ============================================================================
// Setup Flow
// ============================================================================

/**
 * Run the interactive tool setup flow.
 *
 * Uses Vercel AI SDK streamText() to run an agent that helps users
 * set up Verible and Slang with streaming output and approval prompts.
 */
export async function runToolSetupFlow(
  bus: EventBus,
  policy: PolicyEngine,
  projectRoot: string,
  options: ToolSetupOptions = {}
): Promise<ToolSetupResult> {
  // Non-interactive mode - just return skip
  if (options.interactive === false) {
    return { success: true, tools: {} };
  }

  bus.emit({ type: 'status', phase: 'setup', label: 'Starting tool setup assistant...' });

  // Create tool executors
  const executors = createToolSetupExecutors(bus, projectRoot);

  // Wrap tools with approval checking using the AI SDK tool helper
  const tools: Record<string, any> = {};
  const approvalRequired: ToolName[] = ['run_command', 'download_file', 'extract_archive', 'set_env_var', 'install_prerequisite', 'open_install_url'];

  for (const [name, executor] of Object.entries(executors)) {
    const schema = TOOL_SCHEMAS[name];
    if (!schema) continue;

    // Create wrapper that handles approval
    const wrappedExecute = async (args: Record<string, unknown>) => {
      if (approvalRequired.includes(name as ToolName)) {
        const decision = policy.checkTool(name as ToolName, args);
        if (decision.requiresApproval) {
          const approved = await requestApproval(bus, name, args);
          if (!approved) {
            return { skipped: true, reason: 'User declined' };
          }
        }
      }
      return executor(args as any);
    };

    tools[name] = tool({
      description: TOOL_DESCRIPTIONS[name] || `Execute ${name}`,
      inputSchema: zodSchema(schema),
      execute: wrappedExecute as any,
    });
  }

  // Determine initial message based on what's being set up
  const toolsToSetup = options.tools || ['verible', 'slang'];
  const initialMessage = `Please help me set up the following SystemVerilog tools: ${toolsToSetup.join(', ')}`;

  // Conversation state
  const messages: Message[] = [{ role: 'user', content: initialMessage }];
  const model = options.model || 'claude-sonnet-4-20250514';
  const maxTurns = 20; // Prevent infinite loops

  try {
    // Conversation loop - keep going until setup complete or user exits
    for (let turn = 0; turn < maxTurns; turn++) {
      // Run agent turn
      const result = await streamText({
        model: anthropic(model) as any,
        system: TOOL_SETUP_SYSTEM_PROMPT,
        messages,
        tools,
        maxSteps: 25,
      } as any);

      // Collect assistant response and emit events for all stream parts
      let assistantText = '';
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            assistantText += part.text;
            bus.emit({ type: 'token', text: part.text });
            break;

          case 'tool-call':
            bus.emit({
              type: 'tool_call',
              tool: part.toolName,
              argsSummary: JSON.stringify(part.input).slice(0, 100),
              args: part.input as Record<string, unknown>
            });
            break;

          case 'tool-result': {
            const hasError = part.output && typeof part.output === 'object' &&
                            part.output !== null && 'error' in part.output;
            bus.emit({
              type: 'tool_result',
              tool: part.toolName,
              ok: !hasError,
              summary: JSON.stringify(part.output).slice(0, 200)
            });
            break;
          }

          case 'error':
            bus.emit({
              type: 'error',
              message: (part as any).error instanceof Error
                ? (part as any).error.message
                : String((part as any).error)
            });
            break;

          case 'tool-error': {
            const toolError = part as any;
            bus.emit({
              type: 'error',
              message: `Tool ${toolError.toolName} failed: ${
                toolError.error instanceof Error ? toolError.error.message : String(toolError.error)
              }`
            });
            break;
          }
        }
      }

      // Add assistant message to history
      messages.push({ role: 'assistant', content: assistantText });

      // Check if setup is complete
      const setupComplete = await checkSetupComplete(toolsToSetup);
      if (setupComplete.allDone) {
        bus.emit({ type: 'token', text: '\n\nSetup complete!\n' });
        return buildFinalResult(setupComplete);
      }

      // Get user input for next turn
      const userInput = await getUserInput(bus);

      // Check for exit commands
      if (isExitCommand(userInput)) {
        bus.emit({ type: 'token', text: '\nExiting setup.\n' });
        return buildFinalResult(setupComplete);
      }

      // Add user message and continue
      messages.push({ role: 'user', content: userInput });
    }

    // Max turns reached
    bus.emit({ type: 'token', text: '\n\nMax conversation turns reached.\n' });
    const finalStatus = await checkSetupComplete(toolsToSetup);
    return buildFinalResult(finalStatus);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bus.emit({ type: 'error', message: `Setup failed: ${message}` });
    return { success: false, tools: {}, error: message };
  }
}

/**
 * Check if requested tools are set up.
 */
async function checkSetupComplete(toolsToSetup: ('verible' | 'slang')[]): Promise<{
  allDone: boolean;
  verible?: { available: boolean; path?: string; version?: string };
  slang?: { available: boolean; path?: string; version?: string };
}> {
  const result: {
    allDone: boolean;
    verible?: { available: boolean; path?: string; version?: string };
    slang?: { available: boolean; path?: string; version?: string };
  } = { allDone: true };

  if (toolsToSetup.includes('verible')) {
    veribleBinaryManager.clearCache();
    const available = await veribleBinaryManager.isAvailable('verible-verilog-syntax');
    if (available) {
      const loc = await veribleBinaryManager.findBinary('verible-verilog-syntax', false);
      result.verible = { available: true, path: loc.path, version: loc.version };
    } else {
      result.verible = { available: false };
      result.allDone = false;
    }
  }

  if (toolsToSetup.includes('slang')) {
    slangBinaryManager.clearCache();
    const available = await slangBinaryManager.isAvailable();
    if (available) {
      const loc = await slangBinaryManager.findBinary(false);
      result.slang = { available: true, path: loc.path, version: loc.version };
    } else {
      result.slang = { available: false };
      result.allDone = false;
    }
  }

  return result;
}

/**
 * Build final result from setup status.
 */
function buildFinalResult(status: {
  verible?: { available: boolean; path?: string; version?: string };
  slang?: { available: boolean; path?: string; version?: string };
}): ToolSetupResult {
  const result: ToolSetupResult = { success: true, tools: {} };

  if (status.verible) {
    result.tools.verible = status.verible.available
      ? { action: 'installed', path: status.verible.path, version: status.verible.version }
      : { action: 'skipped' };
  }

  if (status.slang) {
    result.tools.slang = status.slang.available
      ? { action: 'built', path: status.slang.path, version: status.slang.version }
      : { action: 'skipped' };
  }

  return result;
}

/**
 * Get user input from terminal using centralized InputManager.
 */
async function getUserInput(bus: EventBus): Promise<string> {
  bus.emit({ type: 'status', phase: 'tool', label: 'Waiting for input...' });

  const inputManager = getInputManager();
  inputManager.initialize();

  const input = await inputManager.getLine('\n> ');
  return input.trim();
}

/**
 * Check if user wants to exit.
 */
function isExitCommand(input: string): boolean {
  const exitCommands = ['exit', 'quit', 'q', 'done', 'skip', 'cancel', 'bye'];
  return exitCommands.includes(input.toLowerCase());
}

// ============================================================================
// Approval Handling
// ============================================================================

/**
 * Request approval from the user via the event bus.
 */
async function requestApproval(bus: EventBus, tool: string, args: any): Promise<boolean> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();

    bus.emit({
      type: 'approval_request',
      id,
      action: tool,
      details: JSON.stringify(args, null, 2),
    });

    // Subscribe to approval_response events
    const subscription = bus.on('approval_response', (event) => {
      if (event.id === id) {
        subscription.unsubscribe();
        resolve(event.approved);
      }
    });
  });
}

// ============================================================================
// Exports
// ============================================================================

export { createToolSetupExecutors, TOOL_DESCRIPTIONS, TOOL_SCHEMAS } from '../../agent/tool-setup-tools.js';
