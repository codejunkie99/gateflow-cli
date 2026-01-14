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

export interface LockInfo {
    pid: number;
    time: number;
}

export interface StaleCheckResult {
    isStale: boolean;
    content: string;
}

export interface FileLockConfig {
    /** Lock timeout in ms */
    lockTimeout: number;
}

// ============================================================================
// File Lock Manager
// ============================================================================

export class FileLockManager {
    private lockAcquired: boolean = false;

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
            } catch (error: any) {
                if (error.code === 'EEXIST') {
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
                // Corrupted/partial JSON - can't determine staleness, but preserve content
                return { isStale: false, content };
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

        } catch (error: any) {
            // Only consider stale if file doesn't exist (already deleted)
            if (error.code === 'ENOENT') {
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
        } catch (error: any) {
            // Another process got it first
            if (error.code !== 'EEXIST' && error.code !== 'ENOENT') {
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
            const { spawnSync } = await import('child_process');
            const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
                encoding: 'utf-8',
                timeout: TASKLIST_TIMEOUT_MS
            });
            // If PID not found, tasklist returns "INFO: No tasks..."
            return result.stdout.includes(pid.toString());
        } catch {
            // If tasklist fails, be conservative
            return true;
        }
    }

    private isProcessAliveUnix(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true; // Process exists
        } catch {
            return false; // Process doesn't exist
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
