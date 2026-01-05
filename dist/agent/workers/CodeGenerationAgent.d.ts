/**
 * Code Generation Agent
 * Creates new SystemVerilog modules from specifications
 * Uses AI SDK 6 Agent interface with generation tools
 */
import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
/**
 * Create code generation agent with generation tools
 */
export declare function createCodeGenAgent(tools: Record<string, Tool>): GateFlowAgent;
