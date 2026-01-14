/**
 * KnowledgeStore Lock Manager
 * @module knowledge-store/lock-manager
 *
 * Cross-process file locking for safe concurrent access to knowledge files.
 *
 * ## Locking Strategy
 * Uses exclusive file creation (flag: 'wx') for atomic lock acquisition.
 * The lock file contains JSON with:
 * - `pid`: Process ID of lock holder
 * - `time`: Timestamp when lock was acquired
 *
 * ## Stale Lock Detection
 * A lock is considered stale if ANY of these conditions are met:
 * 1. Lock is older than 5 minutes
 * 2. Lock belongs to current process but we don't hold it (self-heal)
 * 3. Holding process no longer exists (checked via OS)
 *
 * ## TOCTOU Safety
 * When deleting a stale lock, we verify the lock content hasn't changed
 * between reading and deleting to prevent race conditions.
 *
 * ## Platform Differences
 * - **Unix**: Fast `kill(pid, 0)` signal check
 * - **Windows**: Slower `tasklist` command with 1s result caching
 */

import fs from 'fs/promises';

/**
 * Manages file-based cross-process locking for KnowledgeStore.
 *
 * @example
 * const lock = new KnowledgeStoreLockManager('/path/to/store.lock', 5000);
 * if (await lock.acquire()) {
 *     try {
 *         // Safe to write to store file
 *     } finally {
 *         await lock.release();
 *     }
 * }
 */
export class KnowledgeStoreLockManager {
    private lockAcquired = false;

    // Windows lock check cache (Bug 1.4 fix)
    private lockCheckCache?: {
        pid: number;
        isAlive: boolean;
        time: number;
    };

    constructor(
        private readonly lockPath: string,
        private readonly lockTimeoutMs: number
    ) {}

    /**
     * Attempt to acquire the lock within the timeout period.
     * Retries every 100ms if the lock is held by another process.
     *
     * @returns true if lock acquired, false if timeout expired
     */
    async acquire(): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < this.lockTimeoutMs) {
            try {
                await fs.writeFile(
                    this.lockPath,
                    JSON.stringify({ pid: process.pid, time: Date.now() }),
                    { flag: 'wx' }
                );
                this.lockAcquired = true;
                return true;
            } catch (e: unknown) {
                if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
                    // Lock exists - check if stale and get lock info for verification
                    const staleInfo = await this.getStaleInfo();
                    if (staleInfo.isStale) {
                        // TOCTOU-safe: verify lock content hasn't changed before deleting
                        try {
                            // Re-read lock to verify it's the same one we checked
                            const currentContent = await fs.readFile(this.lockPath, 'utf-8');
                            if (currentContent === staleInfo.content) {
                                // Same lock - safe to delete and acquire
                                await fs.unlink(this.lockPath);
                                await fs.writeFile(
                                    this.lockPath,
                                    JSON.stringify({ pid: process.pid, time: Date.now() }),
                                    { flag: 'wx' }
                                );
                                this.lockAcquired = true;
                                return true;
                            }
                            // Lock changed - another process replaced it, retry
                        } catch (innerError: any) {
                            // Another process got it first - continue retrying
                            if (innerError.code !== 'EEXIST' && innerError.code !== 'ENOENT') {
                                throw innerError;
                            }
                        }
                    }
                    // Wait and retry
                    await new Promise(r => setTimeout(r, 100));
                } else {
                    throw e;
                }
            }
        }
        return false;
    }

    /**
     * Release the lock if we hold it.
     * Safe to call even if lock was never acquired.
     */
    async release(): Promise<void> {
        if (this.lockAcquired) {
            try { await fs.unlink(this.lockPath); } catch { /* ignore */ }
            this.lockAcquired = false;
            this.lockCheckCache = undefined;  // Clear cache on release
        }
    }

    /**
     * Get stale lock info for TOCTOU-safe deletion.
     * Returns both staleness status AND original content for verification.
     * This allows the caller to verify the lock hasn't changed before deleting.
     */
    private async getStaleInfo(): Promise<{ isStale: boolean; content: string }> {
        try {
            const content = await fs.readFile(this.lockPath, 'utf-8');

            // Try to parse - if it fails, we still preserve content for TOCTOU check
            let lock: { pid: number; time: number };
            try {
                lock = JSON.parse(content);
            } catch (parseError) {
                // Corrupted/partial JSON - can't determine staleness, but preserve content
                // for TOCTOU verification (caller can check if file changed)
                return { isStale: false, content };
            }

            // Self-heal: if lock belongs to this process but we don't hold it, treat as stale
            if (lock.pid === process.pid && !this.lockAcquired) {
                return { isStale: true, content };
            }

            // Time-based check (5 minutes)
            if (Date.now() - lock.time > 5 * 60 * 1000) {
                return { isStale: true, content };
            }

            // Bug 1.4 fix: Cache Windows lock check result
            if (process.platform === 'win32') {
                // Check if we have a recent cache for this PID
                const cacheAge = this.lockCheckCache ? Date.now() - this.lockCheckCache.time : Infinity;
                const cacheHit = this.lockCheckCache &&
                    this.lockCheckCache.pid === lock.pid &&
                    cacheAge < 1000;  // 1 second cache

                if (cacheHit && this.lockCheckCache) {
                    const isStale = !this.lockCheckCache.isAlive;
                    return { isStale, content };
                }

                // Cache miss or expired - do the slow check
                const { spawnSync } = await import('child_process');
                const result = spawnSync('tasklist', ['/FI', `PID eq ${lock.pid}`, '/NH'], {
                    encoding: 'utf-8',
                    timeout: 2000
                });
                const isAlive = result.stdout.includes(lock.pid.toString());

                // Cache the result
                this.lockCheckCache = {
                    pid: lock.pid,
                    isAlive,
                    time: Date.now()
                };

                return { isStale: !isAlive, content };
            } else {
                // Unix: Fast signal check, no caching needed
                try {
                    process.kill(lock.pid, 0);
                    return { isStale: false, content }; // Process exists
                } catch {
                    return { isStale: true, content }; // Process doesn't exist
                }
            }
        } catch (error: any) {
            // Only consider stale if file doesn't exist (already deleted)
            if (error.code === 'ENOENT') {
                return { isStale: true, content: '' };
            }
            // For permission issues, etc., be conservative
            // Return empty content since we couldn't read it for TOCTOU check
            return { isStale: false, content: '' };
        }
    }
}

