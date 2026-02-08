/**
 * Modular Prompt Builder
 * Composable prompt system replacing monolithic strings
 */

export interface PromptComponent {
    type: 'base' | 'role' | 'constraint' | 'task' | 'format' | 'context' | 'example';
    content: string;
    priority?: number;        // Ordering (lower = earlier in prompt, 0 is valid)
    conditional?: boolean;      // Only include if condition met
    condition?: () => boolean;
}

export interface PromptOptions {
    includeThinkingInstructions?: boolean;
    includeCodeExamples?: boolean;
    maxLength?: number;
    temperature?: number;
}

export class PromptBuilder {
    private components: PromptComponent[] = [];
    private metadata: {
        version: string;
        createdAt: Date;
        author?: string;
    } = {
        version: '1.0',
        createdAt: new Date()
    };

    // ==================== Add Components ====================

    /**
     * Add base layer - always included
     */
    addBase(agentName: string = 'GateFlow'): this {
        this.components.push({
            type: 'base',
            content: `You are ${agentName}, an expert SystemVerilog assistant.

## Non-negotiables

- Do NOT invent file contents, module ports, parameters, or error logs. Use available tools to read/search files and run lint/sim.
- Prefer minimal, targeted changes. Avoid refactors unless explicitly requested.
- Preserve behavioral intent. If uncertain, add a TODO comment describing the uncertainty rather than guessing.
- When proposing code changes, be precise about file paths and exact edits (smallest diff that solves the task).
- If multiple files are implicated, handle them one at a time in dependency order (package -> module -> top -> testbench).
- Only work with SystemVerilog files (.sv, .svh, .v, .vh) - ignore other file types.
- Do NOT traverse node_modules, dist, obj_dir, or .git directories.

## SystemVerilog Style (project defaults)

- Use SystemVerilog constructs (logic, always_ff, always_comb) when generating or modernizing code.

Sequential logic:
- always_ff @(posedge clk or posedge rst) for flip-flops
- Non-blocking assignments (<=) for flops
- Do not mix blocking and non-blocking in the same sequential block

Combinational logic:
- always_comb for combinational blocks
- Provide defaults for all outputs/temps to avoid unintended latches
- case statements must include a default branch unless explicitly justified

General:
- Use explicit widths; avoid unsized constants in arithmetic
- Avoid combinational loops and implicit latch inference
- Prefer logic over reg/wire for internal signals

## SystemVerilog Anti-patterns to Avoid

1. Blocking assignments in sequential blocks for flops
2. Missing default case in case statements
3. Mixing blocking/non-blocking in the same always block
4. Combinational loops (feedback without registers)
5. Unintentional latches (incomplete assignments in comb logic)

## Simulation & Waveform Analysis

When simulating or analyzing waveforms:
- Use \`run_simulation\` with \`analyzeWaveform: true\` to auto-analyze VCD output
- Use \`open_waveform\` to launch interactive terminal waveform viewer
- Use \`analyze_waveform\` for detailed analysis (clocks, X/Z anomalies, coverage)

**VCD File Discovery:**
When user mentions a .vcd file by name (e.g., "show me output.vcd", "open counter.vcd"):
1. FIRST use \`find_vcd_files\` with the filename as pattern to search the project
2. If exactly one match found, use \`open_waveform\` with the full path
3. If multiple matches found, list them and ask user which one
4. If no matches found, tell user no VCD files match that name

**Post-Simulation Waveform Flow:**
After running a simulation that produces a VCD file:
1. Show simulation results (pass/fail, any errors)
2. Use \`ask_user\` to ask: "Would you like to view the waveform? (y/n)"
3. If user says yes, use \`open_waveform\` with the VCD path

**Human-in-the-Loop:**
Use \`ask_user\` tool for confirmations:
- After testbench creation: "Run simulation now? (y/n)"
- After simulation: "View waveform? (y/n)"
- For destructive operations: "This will overwrite X, continue? (y/n)"

## Output Discipline

- If you run tools, summarize key findings (file/line and minimal fix).
- If the user asks for an edit: propose the smallest diff and explain why it fixes the issue.
- If a task is ambiguous, choose the safest interpretation and annotate with TODOs.`,
            priority: 0
        });
        return this;
    }

    /**
     * Add specialized role
     */
    addRole(role: string, expertise: string, tone?: string): this {
        this.components.push({
            type: 'role',
            content: `Role: ${role} specializing in ${expertise}.${tone ? `\nTone: ${tone}` : ''}`,
            priority: 1
        });
        return this;
    }

    /**
     * Add one or multiple constraints
     */
    addConstraint(constraint: string | string[]): this {
        const constraints = Array.isArray(constraint) ? constraint : [constraint];
        this.components.push({
            type: 'constraint',
            content: `Constraints:\n${constraints.map(c => `- ${c}`).join('\n')}`,
            priority: 10
        });
        return this;
    }

    /**
     * Add constraint that's conditional
     */
    addConditionalConstraint(
        constraint: string,
        condition: () => boolean,
        priority: number = 10
    ): this {
        this.components.push({
            type: 'constraint',
            content: constraint,
            priority,
            conditional: true,
            condition
        });
        return this;
    }

    /**
     * Add task description
     */
    addTask(task: string): this {
        this.components.push({
            type: 'task',
            content: `Task: ${task}`,
            priority: 20
        });
        return this;
    }

    /**
     * Add output format specification
     */
    setOutputFormat(format: {
        format: 'json' | 'text' | 'markdown';
        description: string;
        schema?: Record<string, unknown>;
    }): this {
        let content = `Output Format: ${format.format}\n${format.description}`;
        if (format.schema) {
            content += `\n\nSchema:\n\`\`\`json\n${JSON.stringify(format.schema, null, 2)}\n\`\`\``;
        }
        this.components.push({
            type: 'format',
            content,
            priority: 30
        });
        return this;
    }

    /**
     * Add context (files, code, previous results)
     */
    addContext(context: {
        files?: Array<{ path: string; summary: string }>;
        code?: string;
        previousErrors?: string[];
        projectStats?: Record<string, unknown>;
    }): this {
        const parts: string[] = [];
        
        if (context.files && context.files.length > 0) {
            parts.push('Relevant Files:');
            for (const file of context.files) {
                parts.push(`  - ${file.path}: ${file.summary}`);
            }
        }
        
        if (context.code) {
            parts.push('\nContext Code:');
            parts.push('```systemverilog');
            parts.push(context.code.substring(0, 500) + (context.code.length > 500 ? '...' : ''));
            parts.push('```');
        }
        
        if (context.previousErrors && context.previousErrors.length > 0) {
            parts.push('\nPrevious Errors:');
            for (const err of context.previousErrors) {
                parts.push(`  - ${err}`);
            }
        }
        
        if (parts.length > 0) {
            this.components.push({
                type: 'context',
                content: parts.join('\n'),
                priority: 15
            });
        }
        
        return this;
    }

    /**
     * Add raw content without any wrapping
     * Useful for base instructions that shouldn't be wrapped in XML tags
     */
    addRaw(content: string, priority?: number): this {
        if (content?.trim()) {
            this.components.push({
                type: 'base',
                content,
                priority: priority ?? 0
            });
        }
        return this;
    }

    /**
     * Add raw content wrapped in XML-style tags
     * Only includes if content is non-empty
     */
    addWrappedSection(tag: string, content: string, priority?: number): this {
        if (content?.trim()) {
            this.components.push({
                type: 'context',
                content: `<${tag}>\n${content}\n</${tag}>`,
                priority: priority ?? 15
            });
        }
        return this;
    }

    /**
     * Add code example
     */
    addExample(title: string, code: string, explanation?: string): this {
        this.components.push({
            type: 'example',
            content: `Example: ${title}\n\`\`\`systemverilog\n${code}\n\`\`\`${explanation ? `\n${explanation}` : ''}`,
            priority: 5
        });
        return this;
    }

    /**
     * Add thinking instructions (Chain-of-Thought)
     */
    enableThinking(options?: {
        showReasoning?: boolean;
        confidenceThreshold?: number;
    }): this {
        const instructions = [
            'Always show your reasoning process',
            'Break down complex problems into steps',
            'Identify constraints before acting',
            'When uncertain, state assumptions explicitly'
        ];
        
        if (options?.showReasoning) {
            instructions.push('Show step-by-step thinking to user');
        }
        
        if (options?.confidenceThreshold) {
            instructions.push(`Report confidence levels above ${options.confidenceThreshold}`);
        }
        
        this.components.push({
            type: 'base',
            content: `Thinking Instructions:\n${instructions.map(i => `- ${i}`).join('\n')}`,
            priority: 2
        });
        
        return this;
    }

    // ==================== Build and Export ====================

    /**
     * Build final prompt from all components
     */
    build(options?: PromptOptions): string {
        // Filter components based on conditions
        const activeComponents = this.components.filter(c => {
            if (c.conditional && c.condition) {
                return c.condition();
            }
            return true;
        });

        // Sort by priority (lower = earlier, nullish coalescing preserves 0)
        activeComponents.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

        let prompt = activeComponents.map(c => c.content).join('\n\n');
        
        // Apply length limit if specified
        if (options?.maxLength) {
            const separator = '\n\n[...content truncated by limit...]\n\n';
            prompt = prompt.substring(0, options.maxLength) + separator;
        }

        return prompt;
    }

    /**
     * Export as structured object for debugging/analysis
     */
    export(): {
        version: string;
        createdAt: Date;
        components: PromptComponent[];
        componentCount: number;
        estimatedTokens: number;
    } {
        const promptText = this.build();
        const estimatedTokens = Math.ceil(promptText.length / 4); // Rough estimate
        
        return {
            ...this.metadata,
            components: this.components,
            componentCount: this.components.length,
            estimatedTokens
        };
    }

    /**
     * Reset builder for new prompt
     */
    reset(): this {
        this.components = [];
        this.metadata.createdAt = new Date();
        return this;
    }
}

