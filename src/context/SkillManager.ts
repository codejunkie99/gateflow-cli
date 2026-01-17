/**
 * SkillManager
 *
 * Implements Cursor's Pattern 3: Agent Skills
 * - Domain-specific instruction files with triggers
 * - Agents discover skills via grep/semantic search
 * - Skills loaded on-demand, not always in system prompt
 *
 * File structure:
 * ~/.gateflow/skills/
 * ├── _index.json           # Skill name/description/triggers
 * ├── lint_fix.md           # Instructions for lint_fix mode
 * ├── testbench.md          # Instructions for testbench mode
 * ├── debug.md              # Instructions for debug mode
 * └── ...
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ============================================================================
// Types
// ============================================================================

/**
 * Skill definition
 */
export interface Skill {
    /** Skill name (identifier) */
    name: string;
    /** Human-readable description */
    description: string;
    /** Trigger phrases that activate this skill */
    triggers: string[];
    /** Full skill instructions (markdown) */
    content: string;
    /** File path */
    filePath: string;
}

/**
 * Skill index entry (minimal info for discovery)
 */
export interface SkillIndexEntry {
    name: string;
    description: string;
    triggers: string[];
}

/**
 * Skill index
 */
export interface SkillIndex {
    skills: SkillIndexEntry[];
    lastUpdated: number;
}

/**
 * Skill search result
 */
export interface SkillSearchResult {
    skill: SkillIndexEntry;
    relevance: number;
    matchedTrigger?: string;
}

/**
 * Configuration for SkillManager
 */
export interface SkillManagerConfig {
    /** Directory for skill files */
    skillsDir: string;
}

// ============================================================================
// Default Skills
// ============================================================================

const DEFAULT_SKILLS: Omit<Skill, 'filePath'>[] = [
    {
        name: 'lint_fix',
        description: 'Fix linting errors in VHDL/SystemVerilog files',
        triggers: ['fix lint', 'lint errors', 'fix errors', 'lint fix', 'verilator errors'],
        content: `# Lint Fix Mode

When fixing lint errors, follow this systematic approach:

## Strategy

1. **Run lint_file first** to get current errors
2. **Fix in dependency order**: packages first, then modules
3. **After each fix**, re-lint to verify the fix worked
4. **Group related fixes** when possible

## Common Patterns

### Unused Signal
- If truly unused: Remove the signal
- If intentionally unused: Add pragma \`// verilator lint_off UNUSED\`

### Width Mismatch
- Check port widths match instantiation
- Use explicit bit slicing: \`signal[WIDTH-1:0]\`
- Verify parameter values propagate correctly

### Uninitialized Variable
- Add initial value in declaration: \`logic [7:0] data = 8'h00;\`
- Or initialize in reset block

### Implicit Wire
- Declare wires explicitly
- Use \`logic\` instead of implicit net

### Case Statement Not Full
- Add \`default:\` case
- Or use \`unique case\` / \`priority case\`

## Best Practices

- Fix one category of errors at a time
- Start with blocking errors before warnings
- Use \`lint_file\` after each batch of fixes
- Preserve functionality - don't just silence warnings
`
    },
    {
        name: 'testbench',
        description: 'Generate testbenches for SystemVerilog modules',
        triggers: ['testbench', 'test bench', 'generate test', 'create tb', 'write testbench'],
        content: `# Testbench Generation Mode

Generate comprehensive testbenches for SystemVerilog modules.

## Template Structure

\`\`\`systemverilog
module {module_name}_tb;
    // Timing parameters
    localparam CLK_PERIOD = 10;

    // DUT signals
    logic clk;
    logic rst_n;
    // ... other signals

    // DUT instantiation
    {module_name} dut (
        .clk(clk),
        .rst_n(rst_n)
        // ... port connections
    );

    // Clock generation
    initial begin
        clk = 0;
        forever #(CLK_PERIOD/2) clk = ~clk;
    end

    // Reset sequence
    task automatic reset();
        rst_n = 0;
        repeat(5) @(posedge clk);
        rst_n = 1;
        @(posedge clk);
    endtask

    // Test sequence
    initial begin
        $dumpfile("{module_name}_tb.vcd");
        $dumpvars(0, {module_name}_tb);

        reset();

        // Test cases here

        #100 $finish;
    end
endmodule
\`\`\`

## Steps

1. **Analyze the module** using find_module to get ports/parameters
2. **Generate clock/reset** infrastructure
3. **Create test tasks** for each functionality
4. **Add assertions** for expected behavior
5. **Include waveform dump** for debugging

## Test Case Categories

- Reset behavior
- Normal operation
- Edge cases
- Error conditions
- Timing constraints
`
    },
    {
        name: 'debug',
        description: 'Debug failing simulations and unexpected behavior',
        triggers: ['debug', 'simulation fails', 'not working', 'unexpected', 'wrong output'],
        content: `# Debug Mode

Systematic approach to debugging SystemVerilog simulations.

## Debug Checklist

### 1. Verify Compilation
- Run \`lint_file\` on all source files
- Check for implicit wire declarations
- Verify port widths match

### 2. Check Reset Behavior
- Is reset asserted long enough?
- Are all registers properly reset?
- Is the reset polarity correct?

### 3. Examine Waveforms
- Use \`analyze_waveform\` on VCD file
- Check clock edges
- Verify signal timing

### 4. Common Issues

#### X/Z Propagation
- Uninitialized registers
- Unconnected ports
- Race conditions

#### Timing Issues
- Setup/hold violations
- Clock domain crossing
- Combinatorial loops

#### Logic Errors
- Off-by-one in counters
- Wrong operator (= vs ==)
- Missing default cases

## Debug Tools

\`\`\`
# Check for issues in waveform
analyze_waveform({ path: "sim.vcd" })

# Search for specific patterns
search_code({ pattern: "always.*=" })  # Find blocking in sequential

# Grep terminal for errors
grep_context("terminal.log", "Error|Warning")
\`\`\`

## Strategy

1. **Reproduce** the issue consistently
2. **Isolate** the failing component
3. **Add instrumentation** ($display, $monitor)
4. **Check assumptions** about inputs
5. **Verify expected vs actual** outputs
`
    },
    {
        name: 'generate',
        description: 'Generate new SystemVerilog modules from scratch',
        triggers: ['generate', 'create module', 'new module', 'write module'],
        content: `# Module Generation Mode

Generate new SystemVerilog modules following best practices.

## Module Template

\`\`\`systemverilog
/**
 * Module: {name}
 * Description: {description}
 */
module {name} #(
    parameter int WIDTH = 8
) (
    input  logic             clk,
    input  logic             rst_n,
    // Add ports here
    input  logic [WIDTH-1:0] data_in,
    output logic [WIDTH-1:0] data_out
);

    // Internal signals

    // Combinatorial logic

    // Sequential logic
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            // Reset values
        end else begin
            // Normal operation
        end
    end

endmodule
\`\`\`

## Coding Guidelines

### Naming Conventions
- Modules: snake_case (e.g., \`data_processor\`)
- Parameters: UPPER_CASE (e.g., \`DATA_WIDTH\`)
- Signals: snake_case with suffix (\`_i\`, \`_o\`, \`_n\`)
- Clocks: \`clk\` or \`clk_{domain}\`
- Resets: \`rst_n\` (active low) or \`rst\` (active high)

### Structure
1. Module declaration with parameters
2. Port declarations (grouped by function)
3. Internal signal declarations
4. Assignments and instantiations
5. Always blocks (combinatorial, then sequential)

### Best Practices
- Use \`always_ff\` for sequential, \`always_comb\` for combinatorial
- Avoid latches (cover all cases in combinatorial)
- Use non-blocking (\`<=\`) in sequential blocks
- Initialize registers in reset block
`
    },
    {
        name: 'fsm',
        description: 'Design and implement finite state machines',
        triggers: ['fsm', 'state machine', 'finite state', 'states'],
        content: `# FSM Design Mode

Design finite state machines using best practices.

## Two-Process FSM Template (Recommended)

\`\`\`systemverilog
module {name}_fsm (
    input  logic clk,
    input  logic rst_n,
    input  logic start,
    input  logic done,
    output logic busy,
    output logic complete
);

    // State encoding
    typedef enum logic [1:0] {
        IDLE  = 2'b00,
        RUN   = 2'b01,
        DONE  = 2'b10
    } state_t;

    state_t state, next_state;

    // State register (sequential)
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            state <= IDLE;
        else
            state <= next_state;
    end

    // Next state logic (combinatorial)
    always_comb begin
        next_state = state;  // Default: stay in current state

        case (state)
            IDLE: if (start) next_state = RUN;
            RUN:  if (done)  next_state = DONE;
            DONE:            next_state = IDLE;
            default:         next_state = IDLE;
        endcase
    end

    // Output logic (combinatorial)
    always_comb begin
        busy     = (state == RUN);
        complete = (state == DONE);
    end

endmodule
\`\`\`

## Design Steps

1. **Define states** clearly with meaningful names
2. **Draw state diagram** (on paper or in comments)
3. **List all transitions** with conditions
4. **Define outputs** for each state
5. **Choose encoding** (one-hot for FPGAs, binary for ASICs)

## Common Patterns

### Mealy vs Moore
- **Moore**: Outputs depend only on state
- **Mealy**: Outputs depend on state AND inputs

### One-Hot Encoding
\`\`\`systemverilog
typedef enum logic [3:0] {
    IDLE = 4'b0001,
    RUN  = 4'b0010,
    WAIT = 4'b0100,
    DONE = 4'b1000
} state_t;
\`\`\`

### Gray Encoding (for low power)
\`\`\`systemverilog
typedef enum logic [1:0] {
    S0 = 2'b00,
    S1 = 2'b01,
    S2 = 2'b11,
    S3 = 2'b10
} state_t;
\`\`\`
`
    }
];

// ============================================================================
// SkillManager Implementation
// ============================================================================

export class SkillManager {
    private config: SkillManagerConfig;
    private skillIndex: SkillIndex | null = null;
    private skillCache: Map<string, Skill> = new Map();
    private initialized = false;

    constructor(config?: Partial<SkillManagerConfig>) {
        const homeDir = os.homedir();
        this.config = {
            skillsDir: config?.skillsDir ?? path.join(homeDir, '.gateflow', 'skills')
        };
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    async initialize(): Promise<void> {
        if (this.initialized) return;

        await fs.mkdir(this.config.skillsDir, { recursive: true });

        // Check if index exists
        const indexPath = path.join(this.config.skillsDir, '_index.json');
        try {
            await fs.access(indexPath);
        } catch {
            // Initialize with default skills
            await this.writeDefaultSkills();
        }

        // Load index
        await this.loadIndex();
        this.initialized = true;
    }

    /**
     * Write default skills to files
     */
    private async writeDefaultSkills(): Promise<void> {
        const indexEntries: SkillIndexEntry[] = [];

        for (const skill of DEFAULT_SKILLS) {
            // Write skill file
            const content = this.formatSkillAsMarkdown(skill);
            const filePath = path.join(this.config.skillsDir, `${skill.name}.md`);
            await fs.writeFile(filePath, content, 'utf-8');

            indexEntries.push({
                name: skill.name,
                description: skill.description,
                triggers: skill.triggers
            });
        }

        // Write index
        const index: SkillIndex = {
            skills: indexEntries,
            lastUpdated: Date.now()
        };

        await fs.writeFile(
            path.join(this.config.skillsDir, '_index.json'),
            JSON.stringify(index, null, 2),
            'utf-8'
        );
    }

    /**
     * Format skill as markdown
     */
    private formatSkillAsMarkdown(skill: Omit<Skill, 'filePath'>): string {
        let md = `---\n`;
        md += `name: ${skill.name}\n`;
        md += `description: ${skill.description}\n`;
        md += `triggers:\n`;
        for (const trigger of skill.triggers) {
            md += `  - "${trigger}"\n`;
        }
        md += `---\n\n`;
        md += skill.content;
        return md;
    }

    /**
     * Load skill index
     */
    private async loadIndex(): Promise<void> {
        const indexPath = path.join(this.config.skillsDir, '_index.json');
        try {
            const content = await fs.readFile(indexPath, 'utf-8');
            this.skillIndex = JSON.parse(content);
        } catch {
            this.skillIndex = { skills: [], lastUpdated: 0 };
        }
    }

    // ========================================================================
    // Skill Discovery (Pattern 3)
    // ========================================================================

    /**
     * Get minimal skill index for context
     * Just names and descriptions, not full content
     */
    async getSkillIndex(): Promise<SkillIndexEntry[]> {
        await this.initialize();
        return this.skillIndex?.skills ?? [];
    }

    /**
     * Discover relevant skill for a query
     * Checks triggers first, then does text search
     */
    async discoverSkill(query: string): Promise<Skill | null> {
        await this.initialize();

        const queryLower = query.toLowerCase();

        // Check triggers first (fast path)
        for (const entry of this.skillIndex?.skills ?? []) {
            for (const trigger of entry.triggers) {
                if (queryLower.includes(trigger.toLowerCase())) {
                    return this.loadSkill(entry.name);
                }
            }
        }

        // Grep skill files for query (slower path)
        const results = await this.searchSkills(query);
        if (results.length > 0) {
            return this.loadSkill(results[0].skill.name);
        }

        return null;
    }

    /**
     * Search skills by query
     */
    async searchSkills(query: string, maxResults = 5): Promise<SkillSearchResult[]> {
        await this.initialize();

        const queryLower = query.toLowerCase();
        const results: SkillSearchResult[] = [];

        for (const entry of this.skillIndex?.skills ?? []) {
            let relevance = 0;
            let matchedTrigger: string | undefined;

            // Check triggers
            for (const trigger of entry.triggers) {
                if (queryLower.includes(trigger.toLowerCase())) {
                    relevance = 1.0;
                    matchedTrigger = trigger;
                    break;
                }
                if (trigger.toLowerCase().includes(queryLower)) {
                    relevance = Math.max(relevance, 0.8);
                    matchedTrigger = trigger;
                }
            }

            // Check name
            if (entry.name.toLowerCase().includes(queryLower)) {
                relevance = Math.max(relevance, 0.7);
            }

            // Check description
            if (entry.description.toLowerCase().includes(queryLower)) {
                relevance = Math.max(relevance, 0.5);
            }

            // Search file content
            if (relevance === 0) {
                const skill = await this.loadSkill(entry.name);
                if (skill && skill.content.toLowerCase().includes(queryLower)) {
                    relevance = 0.3;
                }
            }

            if (relevance > 0) {
                results.push({ skill: entry, relevance, matchedTrigger });
            }
        }

        return results
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, maxResults);
    }

    /**
     * Load full skill content (on-demand)
     */
    async loadSkill(name: string): Promise<Skill | null> {
        await this.initialize();

        // Check cache
        if (this.skillCache.has(name)) {
            return this.skillCache.get(name) ?? null;
        }

        const filePath = path.join(this.config.skillsDir, `${name}.md`);

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const skill = this.parseSkillMarkdown(content, name, filePath);

            // Cache it
            this.skillCache.set(name, skill);
            return skill;
        } catch {
            return null;
        }
    }

    /**
     * Parse skill markdown back to Skill object
     */
    private parseSkillMarkdown(content: string, name: string, filePath: string): Skill {
        // Parse frontmatter
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        let description = '';
        let triggers: string[] = [];

        if (fmMatch) {
            const frontmatter = fmMatch[1];

            // Extract description
            const descMatch = frontmatter.match(/description:\s*(.+)/);
            if (descMatch) description = descMatch[1].trim();

            // Extract triggers
            const triggerSection = frontmatter.match(/triggers:\n((?:\s+-.*\n?)*)/);
            if (triggerSection) {
                triggers = triggerSection[1]
                    .split('\n')
                    .filter(l => l.trim().startsWith('-'))
                    .map(l => l.replace(/^\s*-\s*"?(.+?)"?\s*$/, '$1'));
            }
        }

        // Get content (everything after frontmatter)
        const mainContent = content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

        return {
            name,
            description,
            triggers,
            content: mainContent,
            filePath
        };
    }

    // ========================================================================
    // Skill Management
    // ========================================================================

    /**
     * Add or update a skill
     */
    async addSkill(skill: Omit<Skill, 'filePath'>): Promise<void> {
        await this.initialize();

        // Write skill file
        const content = this.formatSkillAsMarkdown(skill);
        const filePath = path.join(this.config.skillsDir, `${skill.name}.md`);
        await fs.writeFile(filePath, content, 'utf-8');

        // Update index
        const index = this.skillIndex ?? { skills: [], lastUpdated: 0 };
        const existingIdx = index.skills.findIndex(s => s.name === skill.name);

        const entry: SkillIndexEntry = {
            name: skill.name,
            description: skill.description,
            triggers: skill.triggers
        };

        if (existingIdx >= 0) {
            index.skills[existingIdx] = entry;
        } else {
            index.skills.push(entry);
        }

        index.lastUpdated = Date.now();
        this.skillIndex = index;

        await fs.writeFile(
            path.join(this.config.skillsDir, '_index.json'),
            JSON.stringify(index, null, 2),
            'utf-8'
        );

        // Update cache
        this.skillCache.set(skill.name, { ...skill, filePath });
    }

    /**
     * Remove a skill
     */
    async removeSkill(name: string): Promise<boolean> {
        await this.initialize();

        const filePath = path.join(this.config.skillsDir, `${name}.md`);

        try {
            await fs.unlink(filePath);

            // Update index
            if (this.skillIndex) {
                this.skillIndex.skills = this.skillIndex.skills.filter(s => s.name !== name);
                this.skillIndex.lastUpdated = Date.now();

                await fs.writeFile(
                    path.join(this.config.skillsDir, '_index.json'),
                    JSON.stringify(this.skillIndex, null, 2),
                    'utf-8'
                );
            }

            this.skillCache.delete(name);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * List all skill names
     */
    async listSkills(): Promise<string[]> {
        await this.initialize();
        return this.skillIndex?.skills.map(s => s.name) ?? [];
    }

    /**
     * Check if skill exists
     */
    async hasSkill(name: string): Promise<boolean> {
        await this.initialize();
        return this.skillIndex?.skills.some(s => s.name === name) ?? false;
    }

    /**
     * Format skill for agent output
     */
    formatSkillForAgent(skill: Skill): string {
        let output = `# Skill: ${skill.name}\n\n`;
        output += `**Description**: ${skill.description}\n\n`;
        output += `**Triggers**: ${skill.triggers.join(', ')}\n\n`;
        output += `---\n\n`;
        output += skill.content;
        return output;
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalSkillManager: SkillManager | null = null;

/**
 * Get the global SkillManager instance
 */
export function getSkillManager(): SkillManager {
    if (!globalSkillManager) {
        globalSkillManager = new SkillManager();
    }
    return globalSkillManager;
}

/**
 * Create a new SkillManager
 */
export function createSkillManager(config?: Partial<SkillManagerConfig>): SkillManager {
    return new SkillManager(config);
}

/**
 * Set the global SkillManager instance
 */
export function setGlobalSkillManager(manager: SkillManager): void {
    globalSkillManager = manager;
}
