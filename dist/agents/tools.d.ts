/**
 * CLI Agent Tools
 * Function tools using OpenAI Agents SDK for file operations, linting, etc.
 */
import { z } from 'zod';
/**
 * Read a file from the file system
 */
export declare const readFileTool: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    filePath: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filePath: string;
}, {
    filePath: string;
}>, string>;
/**
 * Write content to a file
 */
export declare const writeFileTool: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    filePath: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filePath: string;
    content: string;
}, {
    filePath: string;
    content: string;
}>, string>;
/**
 * List files in a directory
 */
export declare const listFilesTool: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    dirPath: z.ZodString;
    extensions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    dirPath: string;
    extensions?: string[] | undefined;
}, {
    dirPath: string;
    extensions?: string[] | undefined;
}>, string>;
/**
 * Scan codebase recursively for SystemVerilog/Verilog files
 */
export declare const scanCodebaseTool: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    dirPath: z.ZodString;
    maxDepth: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    dirPath: string;
    maxDepth?: number | undefined;
}, {
    dirPath: string;
    maxDepth?: number | undefined;
}>, string>;
/**
 * Lint a SystemVerilog/Verilog file using Verilator
 */
export declare const lintFileTool: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    filePath: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filePath: string;
}, {
    filePath: string;
}>, string>;
/**
 * Custom error for human input required
 */
export declare class HumanInputRequiredError extends Error {
    action: string;
    details: string;
    options?: string[] | undefined;
    constructor(action: string, details: string, options?: string[] | undefined);
}
/**
 * Request approval from the user before performing an action
 */
export declare const requestApprovalTool: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    action: z.ZodString;
    details: z.ZodString;
    options: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    action: string;
    details: string;
    options?: string[] | undefined;
}, {
    action: string;
    details: string;
    options?: string[] | undefined;
}>, string>;
export declare const fileTools: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    filePath: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filePath: string;
}, {
    filePath: string;
}>, string>[];
export declare const lintTools: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    filePath: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filePath: string;
}, {
    filePath: string;
}>, string>[];
export declare const humanLoopTools: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    action: z.ZodString;
    details: z.ZodString;
    options: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    action: string;
    details: string;
    options?: string[] | undefined;
}, {
    action: string;
    details: string;
    options?: string[] | undefined;
}>, string>[];
export declare const allTools: import("@openai/agents-core").FunctionTool<unknown, z.ZodObject<{
    filePath: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filePath: string;
}, {
    filePath: string;
}>, string>[];
