/**
 * Debug Agent
 * Diagnoses and fixes simulation failures
 * Uses AI SDK 6 Agent interface with debug tools
 */
import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
/**
 * Create debug agent with debugging tools
 */
export declare function createDebugAgent(tools: Record<string, Tool>): GateFlowAgent;
