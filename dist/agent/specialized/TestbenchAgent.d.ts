/**
 * Testbench Agent
 * Generates robust SystemVerilog testbenches
 * Uses AI SDK 6 Agent interface with verification tools
 */
import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
/**
 * Create testbench agent with verification tools
 */
export declare function createTestbenchAgent(tools: Record<string, Tool>): GateFlowAgent;
