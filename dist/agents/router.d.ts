/**
 * Router Agent
 * Routes natural language queries to the appropriate specialized agent using agents-as-tools pattern
 */
import { Agent } from '@openai/agents-core';
/**
 * Main router agent - routes user queries to specialized agents
 */
export declare const routerAgent: Agent<unknown, "text">;
