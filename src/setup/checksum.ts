/**
 * Checksum Verification
 *
 * Provides SHA-256 checksum computation and verification for downloaded files.
 * Critical for supply chain security in open-source distribution.
 *
 * @module setup/checksum
 */

import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

// ============================================================================
// Types
// ============================================================================

export interface ChecksumResult {
  /** Computed SHA-256 hash (lowercase hex) */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Time taken to compute (ms) */
  duration: number;
}

export interface VerificationResult {
  /** Whether the checksum matches */
  valid: boolean;
  /** Computed hash */
  computed: string;
  /** Expected hash */
  expected: string;
  /** File size in bytes */
  size: number;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Compute SHA-256 checksum of a file.
 *
 * @param filePath - Path to the file
 * @param onProgress - Optional progress callback (0-100)
 * @returns Checksum result with hash and metadata
 */
export async function computeSHA256(
  filePath: string,
  onProgress?: (percent: number) => void
): Promise<ChecksumResult> {
  const startTime = Date.now();
  const fileStats = await stat(filePath);
  const fileSize = fileStats.size;

  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    let bytesRead = 0;

    stream.on('data', (chunk) => {
      hash.update(chunk);
      bytesRead += chunk.length;

      if (onProgress && fileSize > 0) {
        const percent = Math.round((bytesRead / fileSize) * 100);
        onProgress(percent);
      }
    });

    stream.on('end', () => {
      resolve({
        hash: hash.digest('hex').toLowerCase(),
        size: fileSize,
        duration: Date.now() - startTime,
      });
    });

    stream.on('error', reject);
  });
}

/**
 * Verify a file against an expected SHA-256 checksum.
 *
 * @param filePath - Path to the file
 * @param expectedHash - Expected SHA-256 hash (hex string)
 * @param onProgress - Optional progress callback
 * @returns Verification result
 */
export async function verifySHA256(
  filePath: string,
  expectedHash: string,
  onProgress?: (percent: number) => void
): Promise<VerificationResult> {
  const result = await computeSHA256(filePath, onProgress);
  const normalizedExpected = expectedHash.toLowerCase().trim();

  return {
    valid: result.hash === normalizedExpected,
    computed: result.hash,
    expected: normalizedExpected,
    size: result.size,
  };
}

/**
 * Format a checksum mismatch error message.
 */
export function formatChecksumError(result: VerificationResult): string {
  return [
    'SECURITY ERROR: Checksum verification failed!',
    '',
    `Expected: ${result.expected}`,
    `Computed: ${result.computed}`,
    '',
    'This could indicate:',
    '  - Corrupted download',
    '  - Man-in-the-middle attack',
    '  - Outdated manifest (new release)',
    '',
    'DO NOT use this file. Please retry the download or report this issue.',
  ].join('\n');
}

/**
 * Check if a hash looks valid (64 hex characters for SHA-256).
 */
export function isValidSHA256(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash.trim());
}

/**
 * Placeholder hash indicating checksum needs to be computed.
 */
export const CHECKSUM_PLACEHOLDER = 'CHECKSUM_NEEDED';

/**
 * Check if checksum is a placeholder.
 */
export function isChecksumPlaceholder(hash: string): boolean {
  return hash === CHECKSUM_PLACEHOLDER || !isValidSHA256(hash);
}
