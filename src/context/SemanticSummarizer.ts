/**
 * SemanticSummarizer
 *
 * Implements intelligent context compaction following Anthropic's guidance:
 * - Importance scoring for messages
 * - Tool result clearing (remove raw outputs, keep file references)
 * - Preserve: errors, decisions, unresolved issues
 * - LLM-assisted summarization using Haiku (fast model)
 *
 * Key pattern from Anthropic: "Compaction with tool result clearing -
 * a lightweight form that removes raw outputs deep in history since
 * agents don't need to revisit them"
 */

import type { EventBus } from '../events/bus.js';
import type { TokenBudgetManager } from './TokenBudgetManager.js';
import type { DynamicContextManager, ToolOutputRef } from './DynamicContextManager.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Message for summarization
 */
export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    turn?: number;
    timestamp?: number;
    toolCalls?: Array<{ name: string; result?: string }>;
}

/**
 * Message importance score
 */
export interface MessageImportance {
    index: number;
    message: Message;
    score: number;
    factors: ImportanceFactor[];
    preserve: boolean;
}

/**
 * Factor contributing to importance score
 */
export interface ImportanceFactor {
    name: string;
    weight: number;
    matched: boolean;
    details?: string;
}

/**
 * Importance weights configuration
 */
export interface ImportanceWeights {
    /** Errors/failures: high importance */
    error: number;
    /** Architectural decisions */
    decision: number;
    /** Unresolved issues */
    unresolved: number;
    /** Code generation outputs */
    codeGen: number;
    /** User emphasis ("important", "remember") */
    emphasized: number;
    /** Recency bonus per turn from current */
    recency: number;
}

/**
 * Tool result clearing options
 */
export interface ToolClearingOptions {
    /** Turns after which to clear tool results */
    turnThreshold: number;
    /** Tool outputs to always preserve (e.g., errors) */
    preserveTools: string[];
    /** Placeholder for cleared results */
    placeholder: string;
}

/**
 * Compaction result
 */
export interface CompactionResult {
    /** Original messages */
    original: Message[];
    /** Compacted messages */
    compacted: Message[];
    /** Tokens saved */
    tokensSaved: number;
    /** Summary of what was compacted */
    summary: string;
    /** Messages that were preserved */
    preservedIndices: number[];
    /** Files referenced (for agent recovery) */
    fileReferences: string[];
}

/**
 * Summarizer configuration
 */
export interface SemanticSummarizerConfig {
    /** Importance weights */
    weights: ImportanceWeights;
    /** Tool clearing options */
    toolClearing: ToolClearingOptions;
    /** Minimum importance score to preserve (0-1) */
    preserveThreshold: number;
    /** Maximum messages to preserve verbatim */
    maxPreserveMessages: number;
}

/**
 * Options for abstractive summarization
 */
export interface AbstractiveSummarizeOptions {
    /** Maximum number of issues to include (0 = unlimited) */
    maxIssues?: number;
    /** Maximum number of topics to include (0 = unlimited) */
    maxTopics?: number;
    /** Maximum number of actions to include (0 = unlimited) */
    maxActions?: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_IMPORTANCE_WEIGHTS: ImportanceWeights = {
    error: 0.4,
    decision: 0.3,
    unresolved: 0.3,
    codeGen: 0.2,
    emphasized: 0.2,
    recency: 0.1
};

export const DEFAULT_TOOL_CLEARING: ToolClearingOptions = {
    turnThreshold: 3,
    preserveTools: ['lint_file', 'run_simulation'],  // Always preserve error-containing tools
    placeholder: '[Output cleared - use grep_context or search_history to recover]'
};

// Detection patterns
const DETECTION_PATTERNS = {
    error: [
        /error:/i,
        /failed:/i,
        /exception/i,
        /warning:/i,
        /lint.*error/i,
        /compilation.*fail/i,
        /simulation.*fail/i,
        /assertion.*fail/i
    ],
    decision: [
        /decided to/i,
        /architecture/i,
        /approach/i,
        /strategy/i,
        /chose/i,
        /will use/i,
        /implementation plan/i,
        /design decision/i
    ],
    unresolved: [
        /todo/i,
        /fixme/i,
        /need to/i,
        /should.*later/i,
        /unresolved/i,
        /pending/i,
        /still need/i,
        /not yet/i
    ],
    codeGen: [
        /```(?:sv|vhdl|systemverilog|verilog)/i,
        /module\s+\w+/,
        /endmodule/,
        /created.*file/i,
        /wrote.*to/i,
        /generated.*module/i
    ],
    emphasized: [
        /important/i,
        /critical/i,
        /must/i,
        /remember/i,
        /don't forget/i,
        /key point/i,
        /note:/i,
        /crucial/i
    ]
};

// ============================================================================
// SemanticSummarizer Implementation
// ============================================================================

export class SemanticSummarizer {
    private bus: EventBus | null;
    private tokenManager: TokenBudgetManager | null;
    private contextManager: DynamicContextManager | null;
    private config: SemanticSummarizerConfig;

    constructor(
        bus: EventBus | null = null,
        tokenManager: TokenBudgetManager | null = null,
        contextManager: DynamicContextManager | null = null,
        config?: Partial<SemanticSummarizerConfig>
    ) {
        this.bus = bus;
        this.tokenManager = tokenManager;
        this.contextManager = contextManager;

        this.config = {
            weights: config?.weights ?? DEFAULT_IMPORTANCE_WEIGHTS,
            toolClearing: config?.toolClearing ?? DEFAULT_TOOL_CLEARING,
            preserveThreshold: config?.preserveThreshold ?? 0.5,
            maxPreserveMessages: config?.maxPreserveMessages ?? 10
        };
    }

    // ========================================================================
    // Importance Scoring
    // ========================================================================

    /**
     * Score all messages by importance
     */
    scoreMessages(messages: Message[], currentTurn?: number): MessageImportance[] {
        const turn = currentTurn ?? messages.length;

        return messages.map((message, index) => {
            const factors: ImportanceFactor[] = [];
            let score = 0;

            // Check for error indicators
            if (this.hasPatternMatch(message.content, DETECTION_PATTERNS.error)) {
                factors.push({
                    name: 'error',
                    weight: this.config.weights.error,
                    matched: true,
                    details: 'Contains error/failure indicators'
                });
                score += this.config.weights.error;
            }

            // Check for decision indicators
            if (this.hasPatternMatch(message.content, DETECTION_PATTERNS.decision)) {
                factors.push({
                    name: 'decision',
                    weight: this.config.weights.decision,
                    matched: true,
                    details: 'Contains architectural decision'
                });
                score += this.config.weights.decision;
            }

            // Check for unresolved issues
            if (this.hasPatternMatch(message.content, DETECTION_PATTERNS.unresolved)) {
                factors.push({
                    name: 'unresolved',
                    weight: this.config.weights.unresolved,
                    matched: true,
                    details: 'Contains unresolved issue'
                });
                score += this.config.weights.unresolved;
            }

            // Check for code generation
            if (this.hasPatternMatch(message.content, DETECTION_PATTERNS.codeGen)) {
                factors.push({
                    name: 'codeGen',
                    weight: this.config.weights.codeGen,
                    matched: true,
                    details: 'Contains generated code'
                });
                score += this.config.weights.codeGen;
            }

            // Check for emphasis
            if (this.hasPatternMatch(message.content, DETECTION_PATTERNS.emphasized)) {
                factors.push({
                    name: 'emphasized',
                    weight: this.config.weights.emphasized,
                    matched: true,
                    details: 'User emphasized importance'
                });
                score += this.config.weights.emphasized;
            }

            // Recency bonus (more recent = more important)
            const messageIndex = message.turn ?? index;
            const turnsFromCurrent = turn - messageIndex;
            const recencyBonus = Math.max(0, this.config.weights.recency * (5 - turnsFromCurrent) / 5);
            if (recencyBonus > 0) {
                factors.push({
                    name: 'recency',
                    weight: recencyBonus,
                    matched: true,
                    details: `${turnsFromCurrent} turns ago`
                });
                score += recencyBonus;
            }

            // Normalize score to 0-1
            score = Math.min(1, score);

            return {
                index,
                message,
                score,
                factors,
                preserve: score >= this.config.preserveThreshold
            };
        });
    }

    /**
     * Check if content matches any pattern in a list
     */
    private hasPatternMatch(content: string, patterns: RegExp[]): boolean {
        return patterns.some(pattern => pattern.test(content));
    }

    // ========================================================================
    // Tool Result Clearing (Anthropic Pattern)
    // ========================================================================

    /**
     * Clear raw tool outputs from old messages
     * Implements Anthropic's "Compaction with tool result clearing" pattern
     */
    clearToolResults(
        messages: Message[],
        currentTurn: number,
        options?: Partial<ToolClearingOptions>
    ): { messages: Message[]; clearedCount: number; fileRefs: string[] } {
        const opts = { ...this.config.toolClearing, ...options };
        const result: Message[] = [];
        let clearedCount = 0;
        const fileRefs: string[] = [];

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            const turn = message.turn ?? i;
            const turnsAgo = currentTurn - turn;

            // Only clear if old enough
            if (turnsAgo < opts.turnThreshold) {
                result.push(message);
                continue;
            }

            // Check if this message has tool results to clear
            if (message.role === 'assistant' && message.toolCalls?.length) {
                let clearedContent = message.content;
                let messageCleared = false;

                for (const toolCall of message.toolCalls) {
                    // Skip preserved tools (errors are important)
                    if (opts.preserveTools.includes(toolCall.name)) {
                        continue;
                    }

                    // Look for file references in the result
                    if (toolCall.result) {
                        const fileMatch = toolCall.result.match(/File:\s*([^\n]+)/);
                        if (fileMatch) {
                            fileRefs.push(fileMatch[1]);
                        }

                        // Check if result is large (worth clearing)
                        if (toolCall.result.length > 500) {
                            // Replace large result with placeholder
                            clearedContent = clearedContent.replace(
                                toolCall.result,
                                `[${toolCall.name} output cleared - ${opts.placeholder}]`
                            );
                            messageCleared = true;
                        }
                    }
                }

                if (messageCleared) {
                    clearedCount++;
                    result.push({ ...message, content: clearedContent });
                } else {
                    result.push(message);
                }
            } else {
                result.push(message);
            }
        }

        return { messages: result, clearedCount, fileRefs };
    }

    // ========================================================================
    // Compaction Pipeline
    // ========================================================================

    /**
     * Full compaction: score, clear tool results, summarize if needed
     */
    async compact(
        messages: Message[],
        targetTokens: number,
        currentTurn: number,
        sessionId?: string
    ): Promise<CompactionResult> {
        const original = [...messages];
        const preservedIndices: number[] = [];
        const fileReferences: string[] = [];

        // Step 1: Score messages by importance
        const scored = this.scoreMessages(messages, currentTurn);

        // Step 2: Clear old tool results
        const { messages: cleared, clearedCount, fileRefs } = this.clearToolResults(
            messages,
            currentTurn
        );
        fileReferences.push(...fileRefs);

        // Step 3: Write history to file for recovery (if contextManager available)
        if (this.contextManager && sessionId) {
            await this.contextManager.writeHistoryFile(sessionId, messages);
            fileReferences.push(`history.jsonl`);
        }

        // Step 4: Partition by importance
        const highImportance = scored.filter(s => s.preserve);
        const lowImportance = scored.filter(s => !s.preserve);

        // Step 5: Keep high importance messages verbatim
        const toKeep = highImportance
            .sort((a, b) => b.score - a.score)
            .slice(0, this.config.maxPreserveMessages);

        preservedIndices.push(...toKeep.map(s => s.index));

        // Step 6: Summarize low importance messages
        const toSummarize = lowImportance.map(s => s.message);
        const summaryText = this.extractiveSummarize(toSummarize);

        // Step 7: Build compacted message array
        const compacted: Message[] = [];

        // Add system summary of what was compacted
        if (toSummarize.length > 0) {
            compacted.push({
                role: 'system',
                content: `[Context compacted: ${toSummarize.length} messages summarized]\n\n` +
                    `Summary: ${summaryText}\n\n` +
                    `Cleared tool outputs: ${clearedCount}\n` +
                    `Use search_history to recover details if needed.`
            });
        }

        // Add preserved messages (in original order)
        const preservedMessages = toKeep
            .sort((a, b) => a.index - b.index)
            .map(s => cleared[s.index] ?? s.message);
        compacted.push(...preservedMessages);

        // Calculate tokens saved
        const originalTokens = this.countTokens(original);
        const compactedTokens = this.countTokens(compacted);
        const tokensSaved = originalTokens - compactedTokens;

        // Emit event
        this.emitCompactionEvent(original.length, compacted.length, tokensSaved);

        return {
            original,
            compacted,
            tokensSaved,
            summary: summaryText,
            preservedIndices,
            fileReferences
        };
    }

    // ========================================================================
    // Summarization
    // ========================================================================

    /**
     * Extractive summarization (fast, no LLM)
     * Extracts key sentences based on importance patterns
     */
    extractiveSummarize(messages: Message[], maxLength = 500): string {
        const keyPoints: string[] = [];

        for (const message of messages) {
            const content = message.content;

            // Extract sentences containing important patterns
            const sentences = content.split(/[.!?]+/).filter(s => s.trim());

            for (const sentence of sentences) {
                // Check for key patterns
                const isImportant =
                    DETECTION_PATTERNS.decision.some(p => p.test(sentence)) ||
                    DETECTION_PATTERNS.unresolved.some(p => p.test(sentence)) ||
                    DETECTION_PATTERNS.error.some(p => p.test(sentence));

                if (isImportant && sentence.length < 200) {
                    keyPoints.push(sentence.trim());
                }
            }
        }

        // Deduplicate and limit
        const unique = [...new Set(keyPoints)];
        let result = '';

        for (const point of unique) {
            if (result.length + point.length + 2 > maxLength) break;
            result += (result ? '. ' : '') + point;
        }

        return result || 'Previous messages discussed general implementation details.';
    }

    /**
     * Simple abstractive summary (uses patterns, no LLM call)
     * Could be enhanced with actual LLM call for better quality
     *
     * @param messages - Messages to summarize
     * @param options - Optional limits for issues, topics, and actions (0 = unlimited)
     */
    abstractiveSummarize(messages: Message[], options: AbstractiveSummarizeOptions = {}): string {
        const { maxIssues = 0, maxTopics = 0, maxActions = 0 } = options;

        const topics: string[] = [];
        const actions: string[] = [];
        const issues: string[] = [];

        for (const message of messages) {
            const content = message.content.toLowerCase();

            // Detect topics discussed
            if (content.includes('module') || content.includes('design')) {
                topics.push('module design');
            }
            if (content.includes('testbench') || content.includes('simulation')) {
                topics.push('verification');
            }
            if (content.includes('lint') || content.includes('error')) {
                topics.push('lint fixes');
            }

            // Detect actions taken
            if (content.includes('created') || content.includes('wrote')) {
                actions.push('file modifications');
            }
            if (content.includes('fixed') || content.includes('resolved')) {
                actions.push('bug fixes');
            }

            // Detect unresolved issues
            if (DETECTION_PATTERNS.unresolved.some(p => p.test(message.content))) {
                const match = message.content.match(/(?:todo|need to|should)\s*:?\s*([^.]+)/i);
                if (match) {
                    issues.push(match[1].trim());
                }
            }
        }

        const uniqueTopics = [...new Set(topics)];
        const uniqueActions = [...new Set(actions)];
        const uniqueIssues = [...new Set(issues)];

        // Apply limits only if specified (> 0)
        const limitedTopics = maxTopics > 0 ? uniqueTopics.slice(0, maxTopics) : uniqueTopics;
        const limitedActions = maxActions > 0 ? uniqueActions.slice(0, maxActions) : uniqueActions;
        const limitedIssues = maxIssues > 0 ? uniqueIssues.slice(0, maxIssues) : uniqueIssues;

        let summary = `Discussed: ${limitedTopics.join(', ') || 'general topics'}. `;
        if (limitedActions.length) {
            summary += `Actions: ${limitedActions.join(', ')}. `;
        }
        if (limitedIssues.length) {
            const issuesSuffix = maxIssues > 0 && uniqueIssues.length > maxIssues
                ? ` (+${uniqueIssues.length - maxIssues} more)`
                : '';
            summary += `Unresolved: ${limitedIssues.join('; ')}${issuesSuffix}.`;
        }

        return summary;
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    /**
     * Count tokens in messages
     */
    private countTokens(messages: Message[]): number {
        if (this.tokenManager) {
            return this.tokenManager.countMessageTokens(
                messages.map(m => ({ role: m.role, content: m.content }))
            ).tokens;
        }

        // Fallback: char/4 estimate
        return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    }

    /**
     * Emit compaction event
     */
    private emitCompactionEvent(
        messagesBefore: number,
        messagesAfter: number,
        tokensSaved: number
    ): void {
        if (!this.bus) return;

        this.bus.emit({
            type: 'status',
            phase: 'thinking',
            label: `Compacted ${messagesBefore} → ${messagesAfter} messages (${tokensSaved} tokens saved)`
        });
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /**
     * Update importance weights
     */
    setWeights(weights: Partial<ImportanceWeights>): void {
        this.config.weights = { ...this.config.weights, ...weights };
    }

    /**
     * Update tool clearing options
     */
    setToolClearing(options: Partial<ToolClearingOptions>): void {
        this.config.toolClearing = { ...this.config.toolClearing, ...options };
    }

    /**
     * Get current configuration
     */
    getConfig(): SemanticSummarizerConfig {
        return { ...this.config };
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalSemanticSummarizer: SemanticSummarizer | null = null;

/**
 * Get the global SemanticSummarizer instance
 */
export function getSemanticSummarizer(): SemanticSummarizer {
    if (!globalSemanticSummarizer) {
        globalSemanticSummarizer = new SemanticSummarizer();
    }
    return globalSemanticSummarizer;
}

/**
 * Create a new SemanticSummarizer
 */
export function createSemanticSummarizer(
    bus: EventBus | null = null,
    tokenManager: TokenBudgetManager | null = null,
    contextManager: DynamicContextManager | null = null,
    config?: Partial<SemanticSummarizerConfig>
): SemanticSummarizer {
    return new SemanticSummarizer(bus, tokenManager, contextManager, config);
}

/**
 * Set the global SemanticSummarizer instance
 */
export function setGlobalSemanticSummarizer(summarizer: SemanticSummarizer): void {
    globalSemanticSummarizer = summarizer;
}
