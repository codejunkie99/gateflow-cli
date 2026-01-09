/**
 * File Reader Module
 *
 * Handles reading SystemVerilog files from disk and creating
 * FileRecord objects with metadata needed for indexing.
 *
 * Features:
 * - Reads file content with encoding detection
 * - Computes SHA-256 content hash for change detection
 * - Builds line offset index for fast location lookups
 * - Collects file metadata (size, modification time, etc.)
 *
 * @module reader/file-reader
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { FileRecord, FileReadResult } from '../types/index.js';
import { buildLineIndex } from './line-index.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Supported file encodings.
 * We try UTF-8 first, then fall back to Latin-1 if there are issues.
 */
const SUPPORTED_ENCODINGS: BufferEncoding[] = ['utf-8', 'latin1'];

/**
 * Default encoding to use.
 */
const DEFAULT_ENCODING: BufferEncoding = 'utf-8';

// ============================================================================
// Main Read Function
// ============================================================================

/**
 * Read a file and create a FileRecord with full metadata.
 *
 * This is the main entry point for reading files. It:
 * 1. Reads the file content
 * 2. Computes a SHA-256 hash for change detection
 * 3. Builds a line offset index for fast line lookups
 * 4. Collects file metadata (size, mtime, etc.)
 *
 * @param filePath - Path to the file (will be normalized to absolute)
 * @returns FileReadResult containing FileRecord and content
 *
 * @example
 * ```typescript
 * const result = await readFile('/path/to/counter.sv');
 *
 * console.log(result.file.path);      // '/path/to/counter.sv'
 * console.log(result.file.hash);      // 'a1b2c3d4...' (SHA-256)
 * console.log(result.file.lineCount); // 42
 * console.log(result.content);        // 'module counter...'
 *
 * // Use line index for location lookups
 * const line = getLineNumber(result.file.lineOffsets, matchOffset);
 * ```
 */
export async function readFile(filePath: string): Promise<FileReadResult> {
  // Normalize to absolute path
  const absolutePath = path.resolve(filePath);

  // Read file stats
  const stats = await fs.stat(absolutePath);

  // Read content with encoding detection
  const { content, encoding } = await readWithEncoding(absolutePath);

  // Compute content hash (SHA-256)
  const hash = computeHash(content);

  // Build line offset index
  const lineOffsets = buildLineIndex(content);

  // Create file record
  const file: FileRecord = {
    id: generateFileId(absolutePath, hash),
    path: absolutePath,
    hash,
    size: stats.size,
    lineCount: lineOffsets.length,
    lineOffsets,
    lastModified: stats.mtimeMs,
    encoding,
  };

  return { file, content };
}

// ============================================================================
// Batch Reading
// ============================================================================

/**
 * Read multiple files in parallel.
 *
 * Uses Promise.allSettled to handle partial failures gracefully.
 * Files that fail to read are returned with error information.
 *
 * @param filePaths - Array of file paths to read
 * @param concurrency - Max concurrent reads (default: 10)
 * @returns Array of results (success or error for each file)
 *
 * @example
 * ```typescript
 * const results = await readFiles([
 *   '/path/to/file1.sv',
 *   '/path/to/file2.sv',
 *   '/path/to/file3.sv'
 * ]);
 *
 * for (const result of results) {
 *   if (result.success) {
 *     console.log(`Read: ${result.file.path}`);
 *   } else {
 *     console.error(`Failed: ${result.path} - ${result.error}`);
 *   }
 * }
 * ```
 */
export async function readFiles(
  filePaths: string[],
  concurrency = 10
): Promise<ReadFilesResult[]> {
  const results: ReadFilesResult[] = [];

  // Process in batches for controlled concurrency
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map((filePath) => readFile(filePath))
    );

    for (let j = 0; j < batch.length; j++) {
      const filePath = batch[j];
      const result = batchResults[j];

      if (result.status === 'fulfilled') {
        results.push({
          success: true,
          path: filePath,
          file: result.value.file,
          content: result.value.content,
        });
      } else {
        results.push({
          success: false,
          path: filePath,
          error: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        });
      }
    }
  }

  return results;
}

/**
 * Result from batch file reading.
 */
export type ReadFilesResult =
  | {
      success: true;
      path: string;
      file: FileRecord;
      content: string;
    }
  | {
      success: false;
      path: string;
      error: string;
    };

// ============================================================================
// Change Detection
// ============================================================================

/**
 * Check if a file has changed since it was last indexed.
 *
 * Compares modification time and file size first (fast check),
 * then content hash if needed (thorough check).
 *
 * @param filePath - Path to the file
 * @param existingRecord - Previously indexed FileRecord
 * @returns Object indicating if file changed and what changed
 *
 * @example
 * ```typescript
 * const existing = getStoredFileRecord('/path/to/file.sv');
 * const change = await checkFileChanged('/path/to/file.sv', existing);
 *
 * if (change.changed) {
 *   console.log(`File changed: ${change.reason}`);
 *   // Re-index the file
 * }
 * ```
 */
export async function checkFileChanged(
  filePath: string,
  existingRecord: FileRecord
): Promise<FileChangeResult> {
  try {
    const stats = await fs.stat(filePath);

    // Quick check: modification time
    if (stats.mtimeMs !== existingRecord.lastModified) {
      return {
        changed: true,
        reason: 'mtime',
        newMtime: stats.mtimeMs,
      };
    }

    // Quick check: file size
    if (stats.size !== existingRecord.size) {
      return {
        changed: true,
        reason: 'size',
        newSize: stats.size,
      };
    }

    // Size and mtime match - likely unchanged
    // For thorough check, would need to read and hash (expensive)
    return {
      changed: false,
      reason: 'unchanged',
    };
  } catch (error) {
    // File might have been deleted
    return {
      changed: true,
      reason: 'deleted',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Result from checking if file changed.
 */
export interface FileChangeResult {
  changed: boolean;
  reason: 'mtime' | 'size' | 'hash' | 'deleted' | 'unchanged';
  newMtime?: number;
  newSize?: number;
  newHash?: string;
  error?: string;
}

/**
 * Thorough change detection using content hash.
 *
 * This is slower but definitive - detects changes even if
 * mtime was reset or file was replaced with identical content.
 *
 * @param filePath - Path to the file
 * @param existingHash - Previously computed hash
 * @returns True if content hash changed
 */
export async function checkHashChanged(
  filePath: string,
  existingHash: string
): Promise<boolean> {
  const { content } = await readWithEncoding(filePath);
  const newHash = computeHash(content);
  return newHash !== existingHash;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Read file with encoding detection.
 *
 * Tries UTF-8 first, falls back to Latin-1 if there are issues.
 *
 * @param filePath - Absolute path to the file
 * @returns Content string and detected encoding
 */
async function readWithEncoding(
  filePath: string
): Promise<{ content: string; encoding: string }> {
  // Read as buffer first
  const buffer = await fs.readFile(filePath);

  // Try UTF-8
  try {
    const content = buffer.toString('utf-8');

    // Check for replacement character (indicates encoding issues)
    if (!content.includes('\ufffd')) {
      return { content, encoding: 'utf-8' };
    }
  } catch {
    // UTF-8 failed, try Latin-1
  }

  // Fall back to Latin-1 (never fails, but may not be correct)
  const content = buffer.toString('latin1');
  return { content, encoding: 'latin1' };
}

/**
 * Compute SHA-256 hash of content.
 *
 * @param content - File content string
 * @returns Hex-encoded SHA-256 hash
 */
function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate a file ID from path and hash.
 *
 * The ID is a short hash that uniquely identifies this file.
 *
 * @param filePath - Absolute file path
 * @param contentHash - SHA-256 hash of content
 * @returns File ID in format "file:<16-char-hash>"
 */
function generateFileId(filePath: string, contentHash: string): string {
  // Use first 16 chars of path+hash combination
  const input = `${filePath}:${contentHash}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `file:${hash}`;
}

// ============================================================================
// File Existence Utilities
// ============================================================================

/**
 * Check if a file exists.
 *
 * @param filePath - Path to check
 * @returns True if file exists and is readable
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if path is a SystemVerilog file based on extension.
 *
 * @param filePath - Path to check
 * @returns True if file has .sv, .svh, .v, or .vh extension
 */
export function isSystemVerilogFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.sv', '.svh', '.v', '.vh'].includes(ext);
}

/**
 * Check if path is a filelist based on extension.
 *
 * @param filePath - Path to check
 * @returns True if file has .f extension
 */
export function isFilelistFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.f';
}
