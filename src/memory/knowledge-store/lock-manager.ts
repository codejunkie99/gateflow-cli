/**
 * KnowledgeStore Lock Manager
 * @module knowledge-store/lock-manager
 *
 * Thin wrapper around the shared FileLockManager to avoid duplicate logic.
 */

import { FileLockManager } from "../file-lock.js";

/**
 * Manages file-based cross-process locking for KnowledgeStore.
 */
export class KnowledgeStoreLockManager {
  private lock: FileLockManager;

  constructor(private readonly lockPath: string, lockTimeoutMs: number) {
    this.lock = new FileLockManager(this.lockPath, { lockTimeout: lockTimeoutMs });
  }

  /**
   * Attempt to acquire the lock within the timeout period.
   * Retries every 100ms if the lock is held by another process.
   *
   * @returns true if lock acquired, false if timeout expired
   */
  async acquire(): Promise<boolean> {
    return this.lock.acquire();
  }

  /**
   * Release the lock if we hold it.
   * Safe to call even if lock was never acquired.
   */
  async release(): Promise<void> {
    await this.lock.release();
  }
}
