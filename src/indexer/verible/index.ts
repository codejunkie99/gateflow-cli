/**
 * Verible Integration Module
 *
 * This module provides integration with Verible, a suite of SystemVerilog
 * developer tools from CHIPS Alliance.
 *
 * Features:
 * - Parse SystemVerilog files using verible-verilog-syntax
 * - Lint files using verible-verilog-lint
 * - Format code using verible-verilog-format
 *
 * @module verible
 *
 * @example
 * ```typescript
 * import { VeribleAdapter, isVeribleAvailable } from './verible';
 *
 * // Check if Verible is installed
 * if (await isVeribleAvailable()) {
 *   const adapter = new VeribleAdapter();
 *
 *   // Parse a file
 *   const result = await adapter.parseFile('counter.sv');
 *   console.log(result.declarations);
 *
 *   // Format code
 *   const formatted = await adapter.format(code);
 *
 *   // Lint a file
 *   const lintResult = await adapter.lint('counter.sv');
 * }
 * ```
 */

// Core adapter
export {
  VeribleAdapter,
  createVeribleAdapter,
  parseWithVerible,
  formatWithVerible,
  lintWithVerible,
  type VeribleAdapterOptions,
  type VeribleParseFileResult,
} from './verible-adapter.js';

// Binary management
export {
  VeribleBinaryManager,
  binaryManager,
  findVeribleBinary,
  isVeribleAvailable,
  type Platform,
  type Architecture,
  type VeribleBinary,
  type BinaryLocation,
} from './binary-manager.js';

// Subprocess execution
export {
  parseFile,
  parseFiles,
  lintFile,
  formatContent,
  type VeribleExecOptions,
} from './subprocess.js';

// CST mapping
export {
  CSTMapper,
  createCSTMapper,
  type CSTMapperResult,
} from './cst-mapper.js';

// Types
export {
  isNode,
  isToken,
  NODE_TAGS,
  TOKEN_TAGS,
  type VeribleNode,
  type VeribleToken,
  type VeribleParseResult,
  type VeribleError,
  type VeribleLintResult,
  type VeribleLintViolation,
} from './types.js';
