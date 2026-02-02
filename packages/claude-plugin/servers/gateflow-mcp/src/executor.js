/**
 * Tool Executor
 * Executes GateFlow tools by delegating to the main gateflow-cli package.
 *
 * This is a bridge that imports from the parent gateflow-cli package.
 * In production, gateflow-cli should be installed as a dependency.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { glob } from 'glob';
export function createToolExecutor(projectRoot) {
    const normalizedProjectRoot = path.resolve(projectRoot);
    const execFileAsync = promisify(execFile);
    const resolvePath = (p) => {
        const resolved = path.isAbsolute(p)
            ? path.resolve(p)
            : path.resolve(normalizedProjectRoot, p);
        if (resolved !== normalizedProjectRoot && !resolved.startsWith(normalizedProjectRoot + path.sep)) {
            throw new Error(`Path traversal detected: "${p}" resolves outside project root`);
        }
        return resolved;
    };
    const executors = {
        // ========================================
        // File Operations
        // ========================================
        async read_file(args) {
            const filePath = resolvePath(args.path);
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const start = args.startLine ?? 1;
            const end = args.endLine ?? lines.length;
            const selectedLines = lines.slice(start - 1, end);
            return selectedLines
                .map((line, i) => `${String(start + i).padStart(4)} | ${line}`)
                .join('\n');
        },
        async write_file(args) {
            const filePath = resolvePath(args.path);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, args.content, 'utf-8');
            return { success: true, path: filePath };
        },
        async edit_lines(args) {
            const filePath = resolvePath(args.path);
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const edits = args.edits;
            // Sort edits in reverse order to not affect line numbers
            const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);
            for (const edit of sortedEdits) {
                const newLines = edit.newContent.split('\n');
                lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...newLines);
            }
            await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
            return { success: true, editsApplied: edits.length };
        },
        async search_replace(args) {
            const filePath = resolvePath(args.path);
            let content = await fs.readFile(filePath, 'utf-8');
            const search = args.isRegex
                ? new RegExp(args.search, args.all ? 'g' : '')
                : args.search;
            const before = content;
            if (args.all) {
                content = content.split(search).join(args.replace);
            }
            else {
                content = content.replace(search, args.replace);
            }
            await fs.writeFile(filePath, content, 'utf-8');
            return {
                success: true,
                changed: before !== content,
            };
        },
        async list_files(args) {
            const directory = resolvePath(args.directory);
            const extensions = args.extensions ?? ['.sv'];
            const recursive = args.recursive ?? true;
            const pattern = recursive
                ? `**/*{${extensions.join(',')}}`
                : `*{${extensions.join(',')}}`;
            const files = await glob(pattern, { cwd: directory });
            return files.map(f => path.join(directory, f));
        },
        async search_code(args) {
            const pattern = args.pattern;
            const filePattern = args.filePattern ?? '**/*.sv';
            const maxResults = args.maxResults ?? 50;
            const files = await glob(filePattern, { cwd: projectRoot });
            const results = [];
            const regex = new RegExp(pattern, args.caseSensitive ? '' : 'i');
            for (const file of files) {
                if (results.length >= maxResults)
                    break;
                const filePath = path.join(projectRoot, file);
                const content = await fs.readFile(filePath, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (results.length >= maxResults)
                        break;
                    if (regex.test(lines[i])) {
                        results.push({
                            file,
                            line: i + 1,
                            content: lines[i].trim(),
                        });
                    }
                }
            }
            return results;
        },
        // ========================================
        // SystemVerilog Analysis
        // ========================================
        async find_module(args) {
            const name = args.name;
            const files = await glob('**/*.sv', { cwd: projectRoot });
            for (const file of files) {
                const filePath = path.join(projectRoot, file);
                const content = await fs.readFile(filePath, 'utf-8');
                const moduleRegex = new RegExp(`module\\s+${name}\\s*(#[^;]*)?\\s*\\([^)]*\\)`, 's');
                const match = content.match(moduleRegex);
                if (match) {
                    // Extract ports
                    const portMatch = content.match(new RegExp(`module\\s+${name}[^(]*\\(([^)]+)\\)`, 's'));
                    const ports = portMatch
                        ? portMatch[1].split(',').map(p => p.trim())
                        : [];
                    return {
                        name,
                        file,
                        line: content.substring(0, match.index).split('\n').length,
                        ports,
                    };
                }
            }
            return { error: `Module '${name}' not found` };
        },
        async get_dependencies(args) {
            const moduleName = args.module;
            const files = await glob('**/*.sv', { cwd: projectRoot });
            const dependencies = [];
            // Find the module file first
            let moduleFile = null;
            for (const file of files) {
                const content = await fs.readFile(path.join(projectRoot, file), 'utf-8');
                if (new RegExp(`module\\s+${moduleName}\\b`).test(content)) {
                    moduleFile = file;
                    // Find instantiations
                    const instRegex = /(\w+)\s+(?:#\s*\([^)]*\)\s*)?(\w+)\s*\(/g;
                    let match;
                    while ((match = instRegex.exec(content)) !== null) {
                        const instModule = match[1];
                        if (instModule !== 'module' && instModule !== 'always' &&
                            instModule !== 'if' && instModule !== 'case') {
                            dependencies.push(instModule);
                        }
                    }
                    break;
                }
            }
            return {
                module: moduleName,
                file: moduleFile,
                dependencies: [...new Set(dependencies)],
            };
        },
        async lint_file(args) {
            const filePath = resolvePath(args.path);
            const verilatorPath = process.env.VERILATOR_PATH || 'verilator';
            try {
                const { stdout, stderr } = await execFileAsync(verilatorPath, ['--lint-only', '-Wall', filePath], { timeout: 30000, encoding: 'utf-8' });
                const output = `${stdout ?? ''}${stderr ?? ''}`;
                return { success: true, output, errors: [], warnings: [] };
            }
            catch (error) {
                const stdout = error.stdout?.toString?.() ?? '';
                const stderr = error.stderr?.toString?.() ?? '';
                const output = stdout || stderr ? `${stdout}${stderr}` : error.message;
                const lines = output.split('\n');
                const errors = [];
                const warnings = [];
                for (const line of lines) {
                    if (line.includes('%Error'))
                        errors.push(line);
                    else if (line.includes('%Warning'))
                        warnings.push(line);
                }
                return {
                    success: errors.length === 0,
                    output,
                    errors,
                    warnings,
                };
            }
        },
        async find_all_sv_files(args) {
            const directory = resolvePath(args.directory ?? '.');
            const patterns = ['**/*.sv', '**/*.svh', '**/*.v', '**/*.vh'];
            const files = [];
            for (const pattern of patterns) {
                const matches = await glob(pattern, { cwd: directory });
                files.push(...matches.map(f => path.join(directory, f)));
            }
            return { files, count: files.length };
        },
        async get_project_stats() {
            const files = await glob('**/*.sv', { cwd: projectRoot });
            let moduleCount = 0;
            let packageCount = 0;
            let interfaceCount = 0;
            for (const file of files) {
                const content = await fs.readFile(path.join(projectRoot, file), 'utf-8');
                moduleCount += (content.match(/\bmodule\s+\w+/g) || []).length;
                packageCount += (content.match(/\bpackage\s+\w+/g) || []).length;
                interfaceCount += (content.match(/\binterface\s+\w+/g) || []).length;
            }
            return {
                files: files.length,
                modules: moduleCount,
                packages: packageCount,
                interfaces: interfaceCount,
            };
        },
        // ========================================
        // Simulation & Waveform
        // ========================================
        async run_simulation(args) {
            const top = args.top;
            const testbench = args.testbench ? resolvePath(args.testbench) : undefined;
            const timeout = args.timeout ?? 60000;
            const verilatorPath = process.env.VERILATOR_PATH || 'verilator';
            const files = testbench ? [testbench] : await glob('**/*.sv', { cwd: projectRoot });
            try {
                // Compile
                const compileArgs = ['--binary', '--trace', '-j', '0', '--top-module', top, ...files];
                await execFileAsync(verilatorPath, compileArgs, { cwd: projectRoot, timeout, encoding: 'utf-8' });
                // Run
                const objDir = path.join(projectRoot, 'obj_dir');
                const executable = path.join(objDir, `V${top}`);
                const { stdout, stderr } = await execFileAsync(executable, [], {
                    cwd: projectRoot,
                    timeout,
                    encoding: 'utf-8'
                });
                // Check for VCD
                const vcdFiles = await glob('*.vcd', { cwd: projectRoot });
                const output = `${stdout ?? ''}${stderr ?? ''}`;
                return {
                    success: true,
                    stdout: output,
                    vcdPath: vcdFiles[0] ? path.join(projectRoot, vcdFiles[0]) : undefined,
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error.message,
                    stdout: error.stdout,
                    stderr: error.stderr,
                };
            }
        },
        async analyze_waveform(args) {
            const vcdPath = resolvePath(args.vcdPath);
            const content = await fs.readFile(vcdPath, 'utf-8');
            // Parse VCD header
            const signals = [];
            const varRegex = /\$var\s+\w+\s+(\d+)\s+(\S+)\s+(\S+)/g;
            let match;
            while ((match = varRegex.exec(content)) !== null) {
                signals.push(`${match[3]} [${match[1]}:0]`);
            }
            // Find time range
            const times = content.match(/#(\d+)/g) || [];
            const timeValues = times.map(t => parseInt(t.slice(1)));
            const maxTime = Math.max(...timeValues);
            return {
                file: vcdPath,
                signals: signals.length,
                signalList: signals.slice(0, 20),
                timeRange: { start: 0, end: maxTime },
            };
        },
        async find_vcd_files(args) {
            const directory = resolvePath(args.directory ?? '.');
            const pattern = args.pattern;
            let files = await glob('**/*.vcd', { cwd: directory });
            if (pattern) {
                files = files.filter(f => f.includes(pattern));
            }
            return files.map(f => path.join(directory, f));
        },
        // ========================================
        // Setup & Configuration
        // ========================================
        async check_tool_status(args) {
            const tool = args.tool ?? 'all';
            const status = {};
            const checkCommand = (cmd) => {
                try {
                    const pathResult = execSync(`which ${cmd}`, { encoding: 'utf-8' });
                    const version = execSync(`${cmd} --version 2>&1 | head -1`, { encoding: 'utf-8' });
                    return { installed: true, version: version.trim(), path: pathResult.trim() };
                }
                catch {
                    return { installed: false };
                }
            };
            if (tool === 'verilator' || tool === 'all') {
                status.verilator = checkCommand('verilator');
            }
            if (tool === 'verible' || tool === 'all') {
                status.verible = checkCommand('verible-verilog-syntax');
            }
            if (tool === 'slang' || tool === 'all') {
                status.slang = checkCommand('slang');
            }
            // Add platform info
            status.platform = process.platform;
            status.canAutoInstall = process.platform === 'darwin'; // Homebrew on macOS
            return status;
        },
        async setup_verible() {
            // Try to install via Homebrew on macOS
            const isMac = process.platform === 'darwin';
            if (isMac) {
                try {
                    execSync('brew install verible', {
                        encoding: 'utf-8',
                        stdio: 'pipe',
                        timeout: 300000 // 5 min timeout
                    });
                    const version = execSync('verible-verilog-syntax --version 2>&1 | head -1', { encoding: 'utf-8' });
                    return {
                        success: true,
                        message: `Verible installed successfully: ${version.trim()}`,
                    };
                }
                catch (error) {
                    return {
                        success: false,
                        message: 'Failed to install Verible via Homebrew',
                        error: error.message,
                        manual_instructions: 'Run: brew install verible',
                    };
                }
            }
            return {
                success: false,
                message: 'Auto-install only supported on macOS with Homebrew',
                manual_instructions: [
                    'Visit https://github.com/chipsalliance/verible/releases',
                    'Download for your platform and add to PATH',
                ],
            };
        },
        async setup_slang() {
            const isMac = process.platform === 'darwin';
            if (isMac) {
                try {
                    execSync('brew install slang', {
                        encoding: 'utf-8',
                        stdio: 'pipe',
                        timeout: 300000
                    });
                    const version = execSync('slang --version 2>&1 | head -1', { encoding: 'utf-8' });
                    return {
                        success: true,
                        message: `Slang installed successfully: ${version.trim()}`,
                    };
                }
                catch (error) {
                    return {
                        success: false,
                        message: 'Failed to install Slang via Homebrew',
                        error: error.message,
                        manual_instructions: 'Run: brew install slang',
                    };
                }
            }
            return {
                success: false,
                message: 'Auto-install only supported on macOS with Homebrew',
                manual_instructions: [
                    'git clone https://github.com/MikePopoloski/slang',
                    'cd slang && mkdir build && cd build',
                    'cmake -DCMAKE_BUILD_TYPE=Release ..',
                    'cmake --build . -j',
                ],
            };
        },
        async setup_verilator() {
            const isMac = process.platform === 'darwin';
            if (isMac) {
                try {
                    execSync('brew install verilator', {
                        encoding: 'utf-8',
                        stdio: 'pipe',
                        timeout: 300000
                    });
                    const version = execSync('verilator --version 2>&1 | head -1', { encoding: 'utf-8' });
                    return {
                        success: true,
                        message: `Verilator installed successfully: ${version.trim()}`,
                    };
                }
                catch (error) {
                    return {
                        success: false,
                        message: 'Failed to install Verilator via Homebrew',
                        error: error.message,
                        manual_instructions: 'Run: brew install verilator',
                    };
                }
            }
            return {
                success: false,
                message: 'Auto-install only supported on macOS with Homebrew',
                manual_instructions: [
                    'Ubuntu/Debian: sudo apt-get install verilator',
                    'Fedora: sudo dnf install verilator',
                    'From source: https://verilator.org/guide/latest/install.html',
                ],
            };
        },
        // ========================================
        // Multi-Agent Orchestration
        // ========================================
        async plan_complex_task(args) {
            const task = args.task;
            const context = args.context;
            // Agent capabilities for planning
            const agents = {
                understanding: {
                    name: 'sv-understanding',
                    capabilities: ['analyze code structure', 'trace dependencies', 'explain architecture', 'identify patterns'],
                    bestFor: 'Reading and understanding existing code before making changes',
                },
                codegen: {
                    name: 'sv-codegen',
                    capabilities: ['generate modules', 'write RTL', 'create interfaces', 'implement FSMs'],
                    bestFor: 'Writing new synthesizable SystemVerilog code',
                },
                testbench: {
                    name: 'sv-testbench',
                    capabilities: ['create testbenches', 'write stimulus', 'add assertions', 'generate test cases'],
                    bestFor: 'Creating verification infrastructure and tests',
                },
                debug: {
                    name: 'sv-debug',
                    capabilities: ['fix lint errors', 'resolve width mismatches', 'fix latches', 'debug simulations'],
                    bestFor: 'Fixing errors and debugging issues',
                },
                refactor: {
                    name: 'sv-refactor',
                    capabilities: ['modernize code', 'extract modules', 'improve naming', 'optimize structure'],
                    bestFor: 'Improving code quality without changing functionality',
                },
            };
            // Suggest a plan based on task keywords
            const suggestedSteps = [];
            let stepNum = 1;
            const taskLower = task.toLowerCase();
            // Always start with understanding for complex tasks
            if (taskLower.includes('create') || taskLower.includes('implement') || taskLower.includes('build')) {
                suggestedSteps.push({
                    step: stepNum++,
                    agent: 'understanding',
                    task: 'Analyze existing codebase to understand patterns and conventions',
                });
            }
            // Code generation
            if (taskLower.includes('module') || taskLower.includes('create') || taskLower.includes('implement') || taskLower.includes('write')) {
                suggestedSteps.push({
                    step: stepNum++,
                    agent: 'codegen',
                    task: `Generate the requested code: ${task}`,
                });
            }
            // Testbench if verification mentioned
            if (taskLower.includes('test') || taskLower.includes('verify') || taskLower.includes('testbench')) {
                suggestedSteps.push({
                    step: stepNum++,
                    agent: 'testbench',
                    task: 'Create testbench with comprehensive test cases',
                });
            }
            // Debug/lint check
            suggestedSteps.push({
                step: stepNum++,
                agent: 'debug',
                task: 'Run lint checks and fix any errors',
            });
            // Refactor if quality mentioned
            if (taskLower.includes('clean') || taskLower.includes('refactor') || taskLower.includes('improve')) {
                suggestedSteps.push({
                    step: stepNum++,
                    agent: 'refactor',
                    task: 'Review and improve code quality',
                });
            }
            return {
                task,
                context,
                availableAgents: agents,
                suggestedPlan: suggestedSteps,
                parallelOpportunities: [
                    'codegen + testbench can run in parallel if writing new module with tests',
                    'Multiple understanding agents can analyze different files simultaneously',
                ],
                instructions: 'Use spawn_agent or parallel_agents to execute this plan. Adjust steps as needed.',
            };
        },
        async spawn_agent(args) {
            const agent = args.agent;
            const task = args.task;
            const files = args.files;
            const agentPrompts = {
                understanding: `Analyze the code to understand: ${task}`,
                codegen: `Generate SystemVerilog code: ${task}`,
                testbench: `Create testbench: ${task}`,
                debug: `Debug and fix: ${task}`,
                refactor: `Refactor code: ${task}`,
            };
            return {
                agent,
                task,
                files,
                prompt: agentPrompts[agent] || task,
                claudeCodeInstruction: `Use the Task tool to spawn the '${agent}' agent with this task. The agent markdown file is at agents/sv-${agent}.md`,
                example: `Task tool call: { "subagent_type": "gateflow:sv-${agent}", "prompt": "${agentPrompts[agent]}", "description": "SV ${agent}" }`,
            };
        },
        async parallel_agents(args) {
            const tasks = args.tasks;
            const agentTasks = tasks.map((t, i) => ({
                id: i + 1,
                agent: t.agent,
                task: t.task,
                files: t.files,
                claudeCodeInstruction: `Spawn gateflow:sv-${t.agent} agent`,
            }));
            return {
                parallelTasks: agentTasks,
                count: tasks.length,
                instruction: 'Use multiple Task tool calls in a single message to run these agents in parallel',
                example: 'Send one message with multiple Task tool invocations, each targeting a different agent',
            };
        },
        // ========================================
        // Context & Knowledge
        // ========================================
        async describe_tool(args) {
            const toolName = args.toolName;
            const { createToolDefinitions } = await import('./tools.js');
            const tools = createToolDefinitions();
            const tool = tools[toolName];
            if (!tool) {
                return { error: `Unknown tool: ${toolName}` };
            }
            return {
                name: toolName,
                description: tool.description,
                parameters: tool.inputSchema,
            };
        },
        async search_knowledge(args) {
            // Simplified - in production would use actual knowledge store
            const query = args.query;
            return {
                query,
                results: [],
                message: 'Knowledge search requires full GateFlow integration',
            };
        },
        async get_file_chunk(args) {
            const filePath = resolvePath(args.path);
            const chunkType = args.chunkType;
            const content = await fs.readFile(filePath, 'utf-8');
            const patterns = {
                module: /module\s+\w+[\s\S]*?endmodule/g,
                interface: /interface\s+\w+[\s\S]*?endinterface/g,
                package: /package\s+\w+[\s\S]*?endpackage/g,
                function: /function\s+[\s\S]*?endfunction/g,
                task: /task\s+[\s\S]*?endtask/g,
                always_block: /always(_ff|_comb|_latch)?\s*@[\s\S]*?(?=\n\s*(always|end|assign|$))/g,
            };
            const regex = patterns[chunkType];
            if (!regex) {
                return { error: `Unknown chunk type: ${chunkType}` };
            }
            const matches = content.match(regex) || [];
            return {
                file: filePath,
                chunkType,
                chunks: matches,
                count: matches.length,
            };
        },
    };
    return {
        async execute(toolName, args) {
            const executor = executors[toolName];
            if (!executor) {
                throw new Error(`Unknown tool: ${toolName}`);
            }
            return executor(args);
        },
    };
}
