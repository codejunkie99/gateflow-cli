/**
 * Understanding Agent
 * Reads and analyzes SystemVerilog code files
 * Uses AI SDK 6 Agent interface with analysis tools
 */
import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
/**
 * Create understanding agent with analysis tools
 */
export declare function createUnderstandingAgent(tools: Record<string, Tool>): GateFlowAgent;
