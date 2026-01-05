/**
 * Memory Manager
 * Persistent project context with atomic writes and locking
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
// ============================================================================
// Memory Manager
// ============================================================================
export class MemoryManager {
    projectRoot;
    bus;
    config;
    memory = null;
    projectId;
    memoryPath;
    lockPath;
    lockAcquired = false;
    constructor(projectRoot, bus, config) {
        this.projectRoot = projectRoot;
        this.bus = bus;
        // Generate project ID from path
        this.projectId = crypto
            .createHash('md5')
            .update(path.resolve(projectRoot))
            .digest('hex')
            .slice(0, 12);
        this.config = {
            memoryDir: config?.memoryDir ?? path.join(os.homedir(), '.gateflow'),
            maxHistory: config?.maxHistory ?? 50,
            lockTimeout: config?.lockTimeout ?? 5000
        };
        this.memoryPath = path.join(this.config.memoryDir, `${this.projectId}.json`);
        this.lockPath = path.join(this.config.memoryDir, `${this.projectId}.lock`);
    }
    // ========================================================================
    // Load / Save
    // ========================================================================
    /**
     * Load memory from disk
     */
    async load() {
        // Ensure memory directory exists
        await fs.mkdir(this.config.memoryDir, { recursive: true });
        try {
            const content = await fs.readFile(this.memoryPath, 'utf-8');
            this.memory = JSON.parse(content);
            // Update last access
            this.memory.lastAccess = Date.now();
            // Migrate if needed
            this.memory = this.migrate(this.memory);
            return this.memory;
        }
        catch (error) {
            // Create new memory
            this.memory = this.createDefaultMemory();
            return this.memory;
        }
    }
    /**
     * Save memory to disk (atomic)
     */
    async save() {
        if (!this.memory)
            return;
        // Atomic write: write to temp, then rename
        const tempPath = `${this.memoryPath}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(tempPath, JSON.stringify(this.memory, null, 2), 'utf-8');
            // Rename (atomic on most filesystems)
            await fs.rename(tempPath, this.memoryPath);
            this.bus.emit({
                type: 'memory_saved',
                path: this.memoryPath,
                size: JSON.stringify(this.memory).length
            });
        }
        catch (error) {
            // Clean up temp file if it exists
            try {
                await fs.unlink(tempPath);
            }
            catch { }
            throw error;
        }
    }
    // ========================================================================
    // Locking
    // ========================================================================
    /**
     * Acquire lock for exclusive access
     */
    async acquireLock() {
        const startTime = Date.now();
        while (Date.now() - startTime < this.config.lockTimeout) {
            try {
                // Try to create lock file (fails if exists)
                await fs.writeFile(this.lockPath, JSON.stringify({ pid: process.pid, time: Date.now() }), { flag: 'wx' });
                this.lockAcquired = true;
                return true;
            }
            catch (error) {
                if (error.code === 'EEXIST') {
                    // Lock exists - check if stale
                    if (await this.isLockStale()) {
                        await fs.unlink(this.lockPath);
                        continue;
                    }
                    // Wait and retry
                    await new Promise(r => setTimeout(r, 100));
                }
                else {
                    throw error;
                }
            }
        }
        return false;
    }
    /**
     * Release lock
     */
    async releaseLock() {
        if (this.lockAcquired) {
            try {
                await fs.unlink(this.lockPath);
            }
            catch { }
            this.lockAcquired = false;
        }
    }
    /**
     * Check if lock is stale (process died)
     */
    async isLockStale() {
        try {
            const content = await fs.readFile(this.lockPath, 'utf-8');
            const lock = JSON.parse(content);
            // Consider stale if > 5 minutes old
            if (Date.now() - lock.time > 5 * 60 * 1000) {
                return true;
            }
            // Check if PID is still running (Unix only)
            if (process.platform !== 'win32') {
                try {
                    process.kill(lock.pid, 0);
                    return false; // Process exists
                }
                catch {
                    return true; // Process doesn't exist
                }
            }
            return false;
        }
        catch {
            return true;
        }
    }
    // ========================================================================
    // Memory Operations
    // ========================================================================
    /**
     * Add a conversation summary
     */
    addConversation(summary) {
        if (!this.memory)
            return;
        const conversation = {
            id: crypto.randomUUID(),
            ...summary
        };
        this.memory.history.unshift(conversation);
        // Trim history
        if (this.memory.history.length > this.config.maxHistory) {
            this.memory.history = this.memory.history.slice(0, this.config.maxHistory);
        }
    }
    /**
     * Update project context
     */
    updateContext(updates) {
        if (!this.memory)
            return;
        this.memory.context = { ...this.memory.context, ...updates };
    }
    /**
     * Add a recent file
     */
    addRecentFile(filePath) {
        if (!this.memory)
            return;
        const relativePath = path.relative(this.projectRoot, filePath);
        // Remove if already exists
        const existing = this.memory.context.recentFiles.indexOf(relativePath);
        if (existing > -1) {
            this.memory.context.recentFiles.splice(existing, 1);
        }
        // Add to front
        this.memory.context.recentFiles.unshift(relativePath);
        // Limit to 20
        if (this.memory.context.recentFiles.length > 20) {
            this.memory.context.recentFiles = this.memory.context.recentFiles.slice(0, 20);
        }
    }
    /**
     * Add a module note
     */
    addModuleNote(moduleName, note) {
        if (!this.memory)
            return;
        this.memory.context.moduleNotes[moduleName] = note;
    }
    /**
     * Get approvals
     */
    getApprovals() {
        return this.memory?.approvals ?? [];
    }
    /**
     * Add approval
     */
    addApproval(approval) {
        if (!this.memory)
            return;
        this.memory.approvals.push(approval);
    }
    /**
     * Clear session approvals
     */
    clearSessionApprovals() {
        if (!this.memory)
            return;
        this.memory.approvals = this.memory.approvals.filter(a => a.scope === 'project');
    }
    /**
     * Get memory for AI context
     */
    getContextForAI() {
        if (!this.memory)
            return '';
        const parts = [];
        // Project summary
        if (this.memory.context.projectSummary) {
            parts.push(`Project: ${this.memory.context.projectSummary}`);
        }
        // Recent files
        if (this.memory.context.recentFiles.length > 0) {
            parts.push(`Recent files: ${this.memory.context.recentFiles.slice(0, 5).join(', ')}`);
        }
        // Module notes
        const notes = Object.entries(this.memory.context.moduleNotes);
        if (notes.length > 0) {
            parts.push('Module notes:');
            for (const [mod, note] of notes.slice(0, 5)) {
                parts.push(`  ${mod}: ${note}`);
            }
        }
        // Recent history
        if (this.memory.history.length > 0) {
            parts.push('Recent sessions:');
            for (const conv of this.memory.history.slice(0, 3)) {
                const date = new Date(conv.timestamp).toLocaleDateString();
                parts.push(`  ${date}: ${conv.summary}`);
            }
        }
        return parts.join('\n');
    }
    // ========================================================================
    // Helpers
    // ========================================================================
    createDefaultMemory() {
        return {
            version: 1,
            projectId: this.projectId,
            projectPath: this.projectRoot,
            approvals: [],
            context: {
                recentFiles: [],
                moduleNotes: {}
            },
            history: [],
            preferences: {
                autoApprove: false,
                lintOnSave: true
            },
            created: Date.now(),
            lastAccess: Date.now()
        };
    }
    migrate(memory) {
        // Version migrations would go here
        // For now, just ensure all fields exist
        return {
            ...this.createDefaultMemory(),
            ...memory,
            context: {
                ...this.createDefaultMemory().context,
                ...memory.context
            },
            preferences: {
                ...this.createDefaultMemory().preferences,
                ...memory.preferences
            }
        };
    }
    /**
     * Get current memory (or null if not loaded)
     */
    getMemory() {
        return this.memory;
    }
    /**
     * Get project ID
     */
    getProjectId() {
        return this.projectId;
    }
}
