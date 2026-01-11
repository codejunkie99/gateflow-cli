/**
 * GateFlow Agent Core
 * Main agent orchestration using Vercel AI SDK
 */

import { streamText, generateObject, stepCountIs, type StepResult, type Tool, type ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type { EventBus } from '../events/index.js';
import type { ToolContext, getToolSpecs } from './tools.js';
import { createToolExecutors } from './tools.js';
import { getSystemPrompt, detectMode, type PromptMode, type DetectModeContext } from './prompts.js';
import { ThinkingChain } from './reasoning/ThinkingChain.js';
import { Orchestrator } from './orchestrator/Orchestrator.js';
import { ComplexityDetectionSchema } from '../types/agent-shared.js';
import {
    createUnderstandingAgent,
    createCodeGenAgent,
    createTestbenchAgent,
    createDebugAgent,
    createRefactoringAgent
} from './workers/index.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
    model: string;
    maxTokens: number;
    temperature: number;
    maxToolCalls: number;
    systemPrompt: string;
}

export interface AgentSession {
    messages: ModelMessage[];
    turnCount: number;
    toolCallCount: number;
    startTime: number;
    currentMode: PromptMode;
    hasErrors: boolean; // Tracks if we've seen lint errors this session
    thinkingChain: ThinkingChain; // NEW: Thinking visibility
}

export interface RunOptions {
    onToolCall?: (name: string, args: unknown) => void;
    onToolResult?: (name: string, result: unknown) => void;
    signal?: AbortSignal;
    /** Override the auto-detected mode */
    mode?: PromptMode;
    /** Context for mode detection */
    modeContext?: DetectModeContext;
}

// ============================================================================
// Default System Prompt (fallback - actual prompts come from prompts.ts)
// ============================================================================

const DEFAULT_SYSTEM_PROMPT = getSystemPrompt('general');

// ============================================================================
// Agent Class
// ============================================================================

export class GateFlowAgent {
    private config: AgentConfig;
    private session: AgentSession;
    private toolContext: ToolContext;
    private tools: Record<string, Tool>;
    private executors: ReturnType<typeof createToolExecutors>;
    private orchestrator: Orchestrator | null = null;

    constructor(
        private bus: EventBus,
        toolContext: ToolContext,
        config?: Partial<AgentConfig>
    ) {
        this.config = {
            model: config?.model ?? 'claude-sonnet-4-20250514',
            maxTokens: config?.maxTokens ?? 8192,
            temperature: config?.temperature ?? 0.7,
            maxToolCalls: config?.maxToolCalls ?? 25,
            systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
        };

        this.toolContext = toolContext;
        this.executors = createToolExecutors(toolContext);
        this.tools = this.buildTools();
        this.session = this.createSession();
        
        // Initialize thinking chain (always visible per plan)
        this.session.thinkingChain = new ThinkingChain(bus, { showByDefault: true });
        
        // Initialize orchestrator with worker agents
        this.initializeOrchestrator();
    }

    /**
     * Initialize orchestrator with all specialized agents
     */
    private initializeOrchestrator(): void {
        this.orchestrator = new Orchestrator(this.bus, this.toolContext.projectRoot);
        
        // Register all worker agents
        // Note: Planning is handled by Orchestrator.executeWithPlan(), not as a worker agent
        this.orchestrator.registerWorker('understanding', createUnderstandingAgent(this.tools));
        this.orchestrator.registerWorker('codegen', createCodeGenAgent(this.tools));
        this.orchestrator.registerWorker('testbench', createTestbenchAgent(this.tools));
        this.orchestrator.registerWorker('debug', createDebugAgent(this.tools));
        this.orchestrator.registerWorker('refactoring', createRefactoringAgent(this.tools));
    }

    // ========================================================================
    // Build AI SDK Tools
    // ========================================================================

    private buildTools(): Record<string, Tool> {
        const specs = {
            read_file: {
                description: 'Read the contents of a file. Returns the file content with line numbers.',
                inputSchema: z.object({
                    path: z.string().describe('Path to the file to read'),
                    startLine: z.number().optional().describe('Starting line number (1-indexed)'),
                    endLine: z.number().optional().describe('Ending line number (inclusive)')
                })
            },
            write_file: {
                description: 'Write content to a file. Creates the file if it does not exist.',
                inputSchema: z.object({
                    path: z.string().describe('Path to the file to write'),
                    content: z.string().describe('Full content to write to the file')
                })
            },
            edit_lines: {
                description: 'Edit specific lines in a file. Specify line ranges to replace.',
                inputSchema: z.object({
                    path: z.string().describe('Path to the file to edit'),
                    edits: z.array(z.object({
                        startLine: z.number().describe('First line to replace (1-indexed)'),
                        endLine: z.number().describe('Last line to replace (inclusive)'),
                        newContent: z.string().describe('New content to insert')
                    }))
                })
            },
            search_replace: {
                description: 'Search and replace text in a file.',
                inputSchema: z.object({
                    path: z.string().describe('Path to the file to edit'),
                    search: z.string().describe('Text or regex pattern to search for'),
                    replace: z.string().describe('Replacement text'),
                    all: z.boolean().optional().default(false).describe('Replace all occurrences'),
                    isRegex: z.boolean().optional().default(false).describe('Treat search as regex')
                })
            },
            list_files: {
                description: 'List SystemVerilog (.sv) files in a directory. Automatically filters for .sv files only.',
                inputSchema: z.object({
                    directory: z.string().describe('Directory path to list'),
                    extensions: z.array(z.string()).optional().default(['.sv']).describe('Filter by extensions (default: [".sv"])'),
                    recursive: z.boolean().optional().default(true).describe('List recursively (default: true)')
                })
            },
            search_code: {
                description: 'Search for a pattern across all SystemVerilog (.sv) files in the project.',
                inputSchema: z.object({
                    pattern: z.string().describe('Search pattern (regex)'),
                    filePattern: z.string().optional().default('**/*.sv').describe('Glob pattern for files (default: "**/*.sv")'),
                    caseSensitive: z.boolean().optional().default(false),
                    maxResults: z.number().optional().default(50)
                })
            },
            find_all_sv_files: {
                description: 'Find all SystemVerilog (.sv) files in the project. Use this to discover what .sv files exist.',
                inputSchema: z.object({
                    directory: z.string().optional().default('.').describe('Starting directory (default: project root)')
                })
            },
            find_module: {
                description: 'Find a SystemVerilog module by name.',
                inputSchema: z.object({
                    name: z.string().describe('Module name to find')
                })
            },
            get_dependencies: {
                description: 'Get the dependency graph for a module.',
                inputSchema: z.object({
                    module: z.string().describe('Module name')
                })
            },
            lint_file: {
                description: 'Run Verilator lint on a SystemVerilog file.',
                inputSchema: z.object({
                    path: z.string().describe('Path to the file to lint')
                })
            },
            run_simulation: {
                description: 'Run a simulation with Verilator. Set analyzeWaveform=true to auto-analyze VCD. After simulation, ask user if they want to view the waveform.',
                inputSchema: z.object({
                    top: z.string().describe('Top module name'),
                    testbench: z.string().optional().describe('Testbench file path'),
                    timeout: z.number().optional().describe('Timeout in ms'),
                    analyzeWaveform: z.boolean().optional().default(false).describe('Auto-analyze VCD after simulation')
                })
            },
            open_waveform: {
                description: 'Open interactive terminal waveform viewer for a VCD file. Use after simulation or when user mentions a .vcd file.',
                inputSchema: z.object({
                    vcdPath: z.string().describe('Path to VCD file')
                })
            },
            analyze_waveform: {
                description: 'Analyze a VCD file for clocks, X/Z anomalies, and coverage. Use when user asks to analyze simulation output.',
                inputSchema: z.object({
                    vcdPath: z.string().describe('Path to VCD file'),
                    detectClocks: z.boolean().optional().default(true),
                    checkAnomalies: z.boolean().optional().default(true)
                })
            },
            ask_user: {
                description: 'Ask user a yes/no question. Use after simulation to ask if they want to view waveforms.',
                inputSchema: z.object({
                    question: z.string().describe('Question to ask'),
                    options: z.array(z.string()).optional().describe('Options like ["yes", "no"]'),
                    default: z.string().optional().describe('Default answer')
                })
            },
            find_vcd_files: {
                description: 'Search for VCD waveform files in the project. ALWAYS use this first when user mentions a VCD file by name to find its full path before opening.',
                inputSchema: z.object({
                    directory: z.string().optional().default('.').describe('Starting directory'),
                    pattern: z.string().optional().describe('Filename pattern to match (e.g., "counter" matches "counter.vcd")')
                })
            },
            get_project_stats: {
                description: 'Get project statistics.',
                inputSchema: z.object({})
            },
            // Tool Setup - for installing/configuring analysis tools
            check_tool_status: {
                description: 'Check if SystemVerilog analysis tools (Verible and/or Slang) are installed and working. Use this when the user asks about tool availability, wants to know what tools are installed, or when you need to verify tools before suggesting installation. Returns installation status, version, and path for each tool.',
                inputSchema: z.object({
                    tool: z.enum(['verible', 'slang', 'both']).optional().default('both').describe('Which tool to check (default: both)')
                })
            },
            setup_verible: {
                description: 'Download and configure Verible (SystemVerilog syntax parser). Use this when the user wants to install Verible, asks to set up parsing tools, or needs help getting Verible working. Downloads prebuilt binaries from GitHub - fast and easy, no compilation required. Requires user approval for downloads.',
                inputSchema: z.object({})
            },
            setup_slang: {
                description: 'Build and configure Slang (SystemVerilog semantic analyzer). Use this when the user wants to install Slang, asks to set up semantic analysis, or needs help getting Slang working. WARNING: Requires git, cmake, and a C++20 compiler. Takes several minutes to build from source. Requires user approval for build commands.',
                inputSchema: z.object({})
            }
        };

        const tools: Record<string, Tool> = {};

        for (const [name, spec] of Object.entries(specs)) {
            tools[name] = {
                description: spec.description,
                inputSchema: spec.inputSchema,
                execute: async (args: unknown) => {
                    const executor = (this.executors as any)[name];
                    if (!executor) {
                        throw new Error(`Unknown tool: ${name}`);
                    }
                    return executor(args);
                }
            };
        }

        return tools;
    }

    // ========================================================================
    // Run Agent
    // ========================================================================

    /**
     * Run the agent with a user message
     */
    async run(
        userMessage: string,
        options?: RunOptions
    ): Promise<string> {
        // Validate input
        if (!userMessage || !userMessage.trim()) {
            throw new Error('Message cannot be empty');
        }

        this.session.turnCount++;
        this.session.messages.push({
            role: 'user',
            content: userMessage.trim()
        });

        // Emit status immediately so spinner shows during processing
        this.bus.emit({
            type: 'status',
            phase: 'thinking',
            label: 'Thinking...'
        });

        // Detect mode for this query
        const modeContext: DetectModeContext = {
            hasErrors: this.session.hasErrors,
            ...options?.modeContext
        };
        const mode = options?.mode ?? detectMode(userMessage, modeContext);
        this.session.currentMode = mode;

        // Add thinking step at mode detection
        this.session.thinkingChain.addAnalysisStep(
            `Analyzing request in ${mode} mode`,
            { mode, userMessage },
            0.9
        );

        // AI SDK 6: Use generateObject for complexity detection
        const { object: complexity } = await generateObject({
            model: anthropic(this.config.model) as any,
            schema: ComplexityDetectionSchema,
            prompt: `Does this request need multi-agent coordination?

Request: "${userMessage}"

Multi-agent is needed for:
- Creating multiple files (module + testbench)
- Complex refactoring across files
- Requests with explicit planning language
- Multi-step operations requiring different agents

Return needsMultiAgent: true only for genuinely complex requests.`
        });

        if (complexity.needsMultiAgent && this.orchestrator) {
            this.session.thinkingChain.addCoordinationStep(
                'Using multi-agent orchestrator',
                { reasoning: complexity.reasoning },
                0.9
            );

            // Update spinner for multi-agent mode
            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: 'Planning multi-agent execution...'
            });

            // Use orchestrator for complex requests
            return this.orchestrator.executeWithPlan(userMessage);
        }

        // Simple requests: continue with single-agent flow
        const systemPrompt = getSystemPrompt(mode);

        // Update spinner with detected mode
        this.bus.emit({
            type: 'status',
            phase: 'thinking',
            label: `[${mode}] Generating response...`
        });

        // AI SDK 6: Use stopWhen instead of maxSteps
        const result = streamText({
            model: anthropic(this.config.model) as any,
            system: systemPrompt,
            messages: this.session.messages,
            tools: this.tools,
            maxOutputTokens: this.config.maxTokens,
            temperature: this.config.temperature,
            abortSignal: options?.signal,
            stopWhen: stepCountIs(this.config.maxToolCalls),  // AI SDK handles the loop automatically
            
            // Thinking visibility via onStepFinish
            // Note: Tool call/result events are emitted from the stream loop for real-time updates
            // We only handle thinking chain and error tracking here to avoid duplicate events
            onStepFinish: (step: StepResult<any>) => {
                this.session.thinkingChain.onStepFinish(step);

                // Track lint errors for mode detection (from tool results)
                if (step.toolResults) {
                    for (const toolResult of step.toolResults) {
                        if (toolResult.toolName === 'lint_file') {
                            const output = toolResult.output as { errors?: unknown[] } | null;
                            if (output?.errors && Array.isArray(output.errors) && output.errors.length > 0) {
                                this.session.hasErrors = true;
                            }
                        }
                    }
                }
            }
        });

        let fullResponse = '';
        
        // Process the stream for all event types (AI SDK 6)
        for await (const part of result.fullStream) {
            if (options?.signal?.aborted) {
                throw new Error('Aborted');
            }

            switch (part.type) {
                case 'text-delta':
                    fullResponse += part.text;
                    this.bus.emit({
                        type: 'token',
                        text: part.text
                    });
                    break;
                
                case 'tool-call':
                    // AI SDK 6: Emit tool call event from stream (uses 'input' not 'args')
                    this.bus.emit({
                        type: 'tool_call',
                        tool: part.toolName,
                        argsSummary: this.summarizeArgs(part.input),
                        args: part.input as Record<string, unknown>
                    });
                    options?.onToolCall?.(part.toolName, part.input);
                    break;
                
                case 'tool-result':
                    // AI SDK 6: Emit tool result event from stream (uses 'output' not 'result')
                    const streamHasError = part.output && typeof part.output === 'object' && 
                                    part.output !== null && 'error' in part.output;
                    this.bus.emit({
                        type: 'tool_result',
                        tool: part.toolName,
                        ok: !streamHasError,
                        summary: this.summarizeResult(part.output),
                        result: part.output
                    });
                    options?.onToolResult?.(part.toolName, part.output);
                    
                    // Track lint errors for mode detection
                    if (part.toolName === 'lint_file') {
                        const lintResult = part.output as { errors?: unknown[] } | null;
                        if (lintResult?.errors && Array.isArray(lintResult.errors) && lintResult.errors.length > 0) {
                            this.session.hasErrors = true;
                        }
                    }
                    break;
            }
        }

        // Get final result
        const finalResult = await result;
        const textContent = await finalResult.text;
        
        if (textContent && textContent.trim()) {
            fullResponse = textContent;
            this.session.messages.push({
                role: 'assistant',
                content: textContent
            });
        }
        
        // Update tool call count from final result
        const steps = await finalResult.steps;
        if (steps) {
            this.session.toolCallCount += steps.length;
        }

        this.bus.emit({ type: 'token_done' });

        return fullResponse;
    }

    // ========================================================================
    // Stream Processing
    // ========================================================================
    // NOTE: This method was removed - stream processing is now handled
    // directly in the run() method using AI SDK 6's onStepFinish callback
    // and fullStream iteration. This ensures compatibility with AI SDK 6.

    // ========================================================================
    // Helpers
    // ========================================================================

    private summarizeArgs(args: unknown): string {
        if (!args || typeof args !== 'object') return '';
        
        const obj = args as Record<string, unknown>;
        
        // Common patterns
        if ('path' in obj) return String(obj.path);
        if ('directory' in obj) return String(obj.directory);
        if ('name' in obj) return String(obj.name);
        if ('module' in obj) return String(obj.module);
        if ('pattern' in obj) return String(obj.pattern);
        if ('top' in obj) return String(obj.top);
        
        return Object.keys(obj).slice(0, 2).join(', ');
    }

    private summarizeResult(result: unknown): string {
        if (!result || typeof result !== 'object') return String(result);
        
        const obj = result as Record<string, unknown>;
        
        if ('error' in obj) return `Error: ${obj.error}`;
        // FIX E: Show stderr or meaningful error for simulation failures
        if ('success' in obj && obj.success === false) {
            if ('stderr' in obj && obj.stderr) {
                const stderr = String(obj.stderr).trim();
                // Show first line of stderr if present
                const firstLine = stderr.split('\n')[0];
                return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
            }
            return 'Failed';
        }
        if ('count' in obj) return `${obj.count} items`;
        if ('lines' in obj) return `${obj.lines} lines`;
        if ('replacements' in obj) return `${obj.replacements} replacements`;
        if ('totalMatches' in obj) return `${obj.totalMatches} matches`;
        if ('errors' in obj && Array.isArray(obj.errors)) {
            return obj.errors.length === 0 ? 'Success' : `${obj.errors.length} errors`;
        }
        
        return 'Done';
    }

    // ========================================================================
    // Session Management
    // ========================================================================

    private createSession(): AgentSession {
        return {
            messages: [],
            turnCount: 0,
            toolCallCount: 0,
            startTime: Date.now(),
            currentMode: 'general',
            hasErrors: false,
            thinkingChain: new ThinkingChain(this.bus, { showByDefault: true }) // Will be replaced in constructor
        };
    }

    /**
     * Reset the session (clear history)
     */
    resetSession(): void {
        this.session = this.createSession();
    }

    /**
     * Get current session stats
     */
    getSessionStats(): {
        turnCount: number;
        toolCallCount: number;
        messageCount: number;
        durationMs: number;
    } {
        return {
            turnCount: this.session.turnCount,
            toolCallCount: this.session.toolCallCount,
            messageCount: this.session.messages.length,
            durationMs: Date.now() - this.session.startTime
        };
    }

    /**
     * Add context to the session
     */
    addContext(content: string): void {
        if (!content || !content.trim()) return;
        
        this.session.messages.push({
            role: 'user',
            content: `[Context]: ${content.trim()}`
        });
    }

    /**
     * Get conversation history
     */
    getHistory(): ModelMessage[] {
        return [...this.session.messages];
    }
}

