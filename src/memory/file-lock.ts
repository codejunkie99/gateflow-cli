/**
 * File Lock Manager
 * Cross-platform file locking with stale lock detection
 */

import fs from 'fs/promises';

// ============================================================================
// Constants
// ============================================================================

/** Lock considered stale after this duration (5 minutes) */
const STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000;

/** Retry interval when waiting for lock */
const LOCK_RETRY_INTERVAL_MS = 100;

/** Timeout for Windows tasklist command */
const TASKLIST_TIMEOUT_MS = 2000;

// ============================================================================
// Types
// ============================================================================

interface LockInfo {
    pid: number;
    time: number;
}

interface StaleCheckResult {
    isStale: boolean;
    content: string;
}

interface FileLockConfig {
    /** Lock timeout in ms */
    lockTimeout: number;
}

// ============================================================================
// File Lock Manager
// ============================================================================

export class FileLockManager {
    private lockAcquired: boolean = false;
    private lockCheckCache?: {
        pid: number;
        isAlive: boolean;
        time: number;
    };

    constructor(
        private readonly lockPath: string,
        private readonly config: FileLockConfig
    ) {}

    /**
     * Acquire lock for exclusive access
     *
     * Uses atomic delete-and-acquire pattern to minimize race window when
     * handling stale locks. After detecting a stale lock, we immediately
     * attempt to acquire rather than looping back, reducing the window
     * where another process could interfere.
     *
     * Note: This is a best-effort lock for coordination, not a guarantee.
     * For critical sections, use AsyncMutex for intra-process safety.
     */
    async acquire(): Promise<boolean> {
        const startTime = Date.now();
        // Add buffer for isLockStale() which can take up to 2s on Windows
        const effectiveTimeout = this.config.lockTimeout + 3000;

        while (Date.now() - startTime < effectiveTimeout) {
            try {
                // Try to create lock file (fails if exists)
                await fs.writeFile(
                    this.lockPath,
                    JSON.stringify(this.createLockInfo()),
                    { flag: 'wx' }
                );
                this.lockAcquired = true;
                return true;
            } catch (error: unknown) {
                const errCode = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
                if (errCode === 'EEXIST') {
                    // Lock exists - check if stale and get lock info for verification
                    const staleInfo = await this.getStaleInfo();
                    if (staleInfo.isStale) {
                        // TOCTOU-safe: verify lock content hasn't changed before deleting
                        const acquired = await this.tryAcquireFromStale(staleInfo.content);
                        if (acquired) {
                            return true;
                        }
                    }
                    // Wait and retry
                    await this.sleep(LOCK_RETRY_INTERVAL_MS);
                } else {
                    throw error;
                }
            }
        }

        return false;
    }

    /**
     * Release the lock
     */
    async release(): Promise<void> {
        if (this.lockAcquired) {
            try {
                await fs.unlink(this.lockPath);
            } catch {
                // Lock file may have been removed externally - safe to ignore
            }
            this.lockAcquired = false;
            this.lockCheckCache = undefined;
        }
    }

    /**
     * Check if lock is currently held by this instance
     */
    isHeld(): boolean {
        return this.lockAcquired;
    }

    /**
     * Get stale lock info for TOCTOU-safe deletion.
     * Returns both staleness status AND original content for verification.
     * This allows the caller to verify the lock hasn't changed before deleting.
     */
    async getStaleInfo(): Promise<StaleCheckResult> {
        try {
            const content = await fs.readFile(this.lockPath, 'utf-8');

            // Try to parse - if it fails, we still preserve content for TOCTOU check
            let lock: LockInfo;
            try {
                lock = JSON.parse(content);
            } catch {
                // Corrupted/partial JSON - treat as stale so it can be cleaned up
                return { isStale: true, content };
            }

            // Self-heal: if lock belongs to this process but we don't hold it, treat as stale
            if (lock.pid === process.pid && !this.lockAcquired) {
                return { isStale: true, content };
            }

            // Consider stale if too old
            if (Date.now() - lock.time > STALE_LOCK_THRESHOLD_MS) {
                return { isStale: true, content };
            }

            // Check if process is still alive
            const processAlive = await this.isProcessAlive(lock.pid);
            return { isStale: !processAlive, content };

        } catch (error: unknown) {
            // Only consider stale if file doesn't exist (already deleted)
            const errCode = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
            if (errCode === 'ENOENT') {
                return { isStale: true, content: '' };
            }
            // For permission issues, etc., be conservative
            return { isStale: false, content: '' };
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private createLockInfo(): LockInfo {
        return { pid: process.pid, time: Date.now() };
    }

    /**
     * Try to acquire lock from a known stale lock state
     * Verifies the lock content hasn't changed before deletion
     */
    private async tryAcquireFromStale(expectedContent: string): Promise<boolean> {
        try {
            // Re-read lock to verify it's the same one we checked
            const currentContent = await fs.readFile(this.lockPath, 'utf-8');
            if (currentContent === expectedContent) {
                // Same lock - safe to delete and acquire
                await fs.unlink(this.lockPath);
                await fs.writeFile(
                    this.lockPath,
                    JSON.stringify(this.createLockInfo()),
                    { flag: 'wx' }
                );
                this.lockAcquired = true;
                return true;
            }
            // Lock changed - another process replaced it
            return false;
        } catch (error: unknown) {
            // Another process got it first
            const errCode = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
            if (errCode !== 'EEXIST' && errCode !== 'ENOENT') {
                throw error;
            }
            return false;
        }
    }

    /**
     * Check if a process is still alive (cross-platform)
     */
    private async isProcessAlive(pid: number): Promise<boolean> {
        if (process.platform === 'win32') {
            return this.isProcessAliveWindows(pid);
        }
        return this.isProcessAliveUnix(pid);
    }

    private async isProcessAliveWindows(pid: number): Promise<boolean> {
        try {
            const cacheAge = this.lockCheckCache
                ? Date.now() - this.lockCheckCache.time
                : Infinity;
            const cacheHit = this.lockCheckCache &&
                this.lockCheckCache.pid === pid &&
                cacheAge < 1000;

            if (cacheHit && this.lockCheckCache) {
                return this.lockCheckCache.isAlive;
            }

            const { spawnSync } = await import('child_process');
            const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
                encoding: 'utf-8',
                timeout: TASKLIST_TIMEOUT_MS
            });
            // Use word boundary matching to avoid false positives (e.g., "12" matching "123")
            const pidStr = pid.toString();
            const pidRegex = new RegExp(`\\b${pidStr}\\b`);
            const isAlive = pidRegex.test(result.stdout);

            this.lockCheckCache = {
                pid,
                isAlive,
                time: Date.now()
            };

            return isAlive;
        } catch {
            // If tasklist fails, be conservative
            return true;
        }
    }

    private isProcessAliveUnix(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true; // Process exists
        } catch (error: unknown) {
            // EPERM means process exists but we can't signal it (different user)
            const errCode = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
            if (errCode === 'EPERM') {
                return true;
            }
            // ESRCH means process doesn't exist
            return false;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
