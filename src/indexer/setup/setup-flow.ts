/**
 * Tool Setup Flow
 *
 * Entry point for interactive tool setup using Vercel AI SDK.
 * Helps users set up Verible and Slang with streaming and human-in-the-loop approval.
 *
 * @module indexer/setup/setup-flow
 */

import { streamText, tool, zodSchema } from 'ai';
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
  const approvalRequired: ToolName[] = ['run_command', 'download_file', 'extract_archive', 'set_env_var'];

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

  try {
    // Run the agent with streaming
    const model = options.model || 'claude-sonnet-4-20250514';
    const result = await streamText({
      model: anthropic(model) as any,
      system: TOOL_SETUP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: initialMessage }],
      tools,
      maxSteps: 25,
    } as any);

    // Process the full stream
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        bus.emit({ type: 'token', text: part.text });
      }
    }

    // Check final status
    const finalResult: ToolSetupResult = { success: true, tools: {} };

    // Check Verible
    veribleBinaryManager.clearCache();
    if (await veribleBinaryManager.isAvailable('verible-verilog-syntax')) {
      const loc = await veribleBinaryManager.findBinary('verible-verilog-syntax', false);
      finalResult.tools.verible = { action: 'installed', path: loc.path, version: loc.version };
    }

    // Check Slang
    slangBinaryManager.clearCache();
    if (await slangBinaryManager.isAvailable()) {
      const loc = await slangBinaryManager.findBinary(false);
      finalResult.tools.slang = { action: 'built', path: loc.path, version: loc.version };
    }

    return finalResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bus.emit({ type: 'error', message: `Setup failed: ${message}` });
    return { success: false, tools: {}, error: message };
  }
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
