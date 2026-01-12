/**
 * GateFlow Concurrency Primitives
 * AsyncMutex and Semaphore for safe concurrent operations
 */

// ============================================================================
// Async Mutex
// ============================================================================

/**
 * Asynchronous mutex for exclusive resource access
 * Prevents race conditions in async operations
 */
export class AsyncMutex {
    private locked = false;
    private queue: Array<() => void> = [];

    /**
     * Acquire the mutex lock
     * If already locked, wait until released
     */
    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }

        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    /**
     * Release the mutex lock
     * Wakes up next waiter if any
     */
    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            // Explicitly set locked = true for ownership transfer
            // (defensive: ensures lock state is correct for the new holder)
            this.locked = true;
            next();
        } else {
            this.locked = false;
        }
    }

    /**
     * Execute a function while holding the lock
     * Automatically releases the lock when done
     */
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    /**
     * Check if the mutex is currently locked
     */
    isLocked(): boolean {
        return this.locked;
    }

    /**
     * Get the number of waiters
     */
    getQueueLength(): number {
        return this.queue.length;
    }
}

// ============================================================================
// Read-Write Lock
// ============================================================================

/**
 * Read-Write lock allowing multiple readers or single writer
 */
export class ReadWriteLock {
    private readers = 0;
    private writer = false;
    private writerQueue: Array<() => void> = [];
    private readerQueue: Array<() => void> = [];

    /**
     * Acquire read lock (allows multiple concurrent readers)
     */
    async acquireRead(): Promise<void> {
        if (!this.writer && this.writerQueue.length === 0) {
            this.readers++;
            return;
        }

        return new Promise<void>((resolve) => {
            this.readerQueue.push(resolve);
        });
    }

    /**
     * Release read lock
     */
    releaseRead(): void {
        this.readers--;
        this.tryWakeWriter();
    }

    /**
     * Acquire write lock (exclusive access)
     */
    async acquireWrite(): Promise<void> {
        if (!this.writer && this.readers === 0) {
            this.writer = true;
            return;
        }

        return new Promise<void>((resolve) => {
            this.writerQueue.push(resolve);
        });
    }

    /**
     * Release write lock
     */
    releaseWrite(): void {
        this.writer = false;
        this.tryWakeReaders();
        this.tryWakeWriter();
    }

    private tryWakeWriter(): void {
        if (this.readers === 0 && !this.writer && this.writerQueue.length > 0) {
            this.writer = true;
            const next = this.writerQueue.shift()!;
            next();
        }
    }

    private tryWakeReaders(): void {
        if (!this.writer && this.writerQueue.length === 0) {
            while (this.readerQueue.length > 0) {
                this.readers++;
                const next = this.readerQueue.shift()!;
                next();
            }
        }
    }

    /**
     * Execute a function while holding read lock
     */
    async withReadLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquireRead();
        try {
            return await fn();
        } finally {
            this.releaseRead();
        }
    }

    /**
     * Execute a function while holding write lock
     */
    async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquireWrite();
        try {
            return await fn();
        } finally {
            this.releaseWrite();
        }
    }
}

// ============================================================================
// Semaphore
// ============================================================================

/**
 * Counting semaphore for limiting concurrent operations
 */
export class Semaphore {
    private permits: number;
    private waiting: Array<() => void> = [];

    constructor(private readonly maxPermits: number) {
        this.permits = maxPermits;
    }

    /**
     * Acquire a permit (blocks if none available)
     */
    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }

        return new Promise<void>((resolve) => {
            this.waiting.push(resolve);
        });
    }

    /**
     * Release a permit
     */
    release(): void {
        if (this.waiting.length > 0) {
            const next = this.waiting.shift()!;
            next();
        } else {
            this.permits = Math.min(this.permits + 1, this.maxPermits);
        }
    }

    /**
     * Try to acquire a permit without blocking
     * @returns true if acquired, false if not available
     */
    tryAcquire(): boolean {
        if (this.permits > 0) {
            this.permits--;
            return true;
        }
        return false;
    }

    /**
     * Execute a function while holding a permit
     */
    async withPermit<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    /**
     * Get available permits
     */
    availablePermits(): number {
        return this.permits;
    }

    /**
     * Get number of waiters
     */
    getWaitingCount(): number {
        return this.waiting.length;
    }
}

// ============================================================================
// Mutex Registry
// ============================================================================

/**
 * Registry for named mutexes to coordinate access to shared resources
 */
export class MutexRegistry {
    private mutexes = new Map<string, AsyncMutex>();

    /**
     * Get or create a named mutex
     */
    getMutex(name: string): AsyncMutex {
        let mutex = this.mutexes.get(name);
        if (!mutex) {
            mutex = new AsyncMutex();
            this.mutexes.set(name, mutex);
        }
        return mutex;
    }

    /**
     * Release a named mutex (removes from registry if unused)
     */
    releaseMutex(name: string): void {
        const mutex = this.mutexes.get(name);
        if (mutex && !mutex.isLocked() && mutex.getQueueLength() === 0) {
            this.mutexes.delete(name);
        }
    }

    /**
     * Execute with a named mutex
     */
    async withMutex<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const mutex = this.getMutex(name);
        try {
            return await mutex.withLock(fn);
        } finally {
            this.releaseMutex(name);
        }
    }

    /**
     * Get all registered mutex names
     */
    getRegisteredMutexes(): string[] {
        return [...this.mutexes.keys()];
    }
}

// ============================================================================
// Pre-configured Instances
// ============================================================================

/** Global mutex registry */
export const mutexRegistry = new MutexRegistry();

/** Semaphore for limiting concurrent tool executions */
export const toolExecutionSemaphore = new Semaphore(10);

/** Semaphore for limiting concurrent API requests */
export const apiRequestSemaphore = new Semaphore(5);

/** Semaphore for limiting concurrent file operations */
export const fileOperationSemaphore = new Semaphore(20);
