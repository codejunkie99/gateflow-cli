/**
 * Memory System Type Definitions
 */

import type { ApprovalGrant } from '../../approval/index.js';

// ============================================================================
// Core Types
// ============================================================================

export interface ProjectMemory {
    version: number;
    projectId: string;
    projectPath: string;

    // Tool approvals
    approvals: ApprovalGrant[];

    // Project context (summaries, not raw content)
    context: {
        projectSummary?: string;
        recentFiles: string[];  // Paths only
        moduleNotes: Record<string, string>;  // module -> note
    };

    // Session history (conversation summaries)
    history: ConversationSummary[];

    // User preferences
    preferences: {
        autoApprove: boolean;
        lintOnSave: boolean;
        theme?: string;
    };

    // Metadata
    created: number;
    lastAccess: number;
}

export interface ConversationSummary {
    id: string;
    timestamp: number;
    summary: string;  // Brief description of what was done
    filesModified: string[];
    exitCode: number;
}

export interface MemoryConfig {
    /** Directory for memory files */
    memoryDir: string;
    /** Maximum conversation history to keep */
    maxHistory: number;
    /** Lock timeout in ms */
    lockTimeout: number;
    /** Threshold for archiving messages (message count) */
    archiveThreshold: number;
    /** Number of recent messages to keep after archiving */
    keepRecentMessages: number;
}

// ============================================================================
// Archive Types
// ============================================================================

export interface ChatHistoryFile {
    sessionId: string;
    turnRange: { start: number; end: number };
    summary: string;
    filePath: string;
    timestamp: number;
}

export interface RelevantMessage {
    turnNumber: number;
    role: 'user' | 'assistant';
    content: string;
    relevance: number;
}

export interface ArchivedSession {
    sessionId: string;
    timestamp: number;
    summary: string;
    messageCount: number;
    archiveCount: number;
}

export interface SummarizationResult {
    triggered: boolean;
    historyRef?: {
        filePath: string;
        sessionId: string;
        summary: string;
        messageCount: number;
        turnRange: { start: number; end: number };
        timestamp: number;
        agentInstructions: string;
    };
    remainingMessages: Array<{ role: string; content: string }>;
    summary: string;
}

export interface Message {
    role: string;
    content: string;
}
