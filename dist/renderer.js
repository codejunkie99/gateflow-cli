/**
 * CLI Renderer
 * Renders agent events to the terminal with colors and formatting
 */
import chalk from 'chalk';
// Track state for multi-line rendering
let currentLine = '';
let inCodeBlock = false;
let currentCodeFile = '';
let toolDepth = 0;
/**
 * Render a stream event to the terminal
 */
export function renderEvent(event) {
    switch (event.type) {
        case 'text':
            // Text is now handled by toTextStream() in dual-stream mode
            // Only render if not using dual-stream (fallback)
            // Don't duplicate text output
            break;
        case 'thinking':
            // Show thinking in gray italic (not piped by toTextStream)
            process.stdout.write(chalk.gray.italic(event.content));
            break;
        case 'tool_start':
            toolDepth++;
            // Claude Code style: minimal, clean tool indicators
            // Add visual separation before tools
            if (toolDepth === 1) {
                console.log(); // New line before first tool
            }
            const toolDisplay = formatToolName(event.toolName);
            console.log(chalk.cyan(`  ${toolDisplay}`));
            // Use full arguments object if available, otherwise parse input string
            const toolArgs = event.arguments || (event.input ? (() => {
                try {
                    return JSON.parse(event.input);
                }
                catch {
                    return null;
                }
            })() : null);
            if (toolArgs) {
                const summary = formatToolArguments(event.toolName, toolArgs);
                if (summary) {
                    console.log(chalk.gray(`    ${summary}`));
                }
            }
            break;
        case 'tool_end':
            // Use full result object if available, otherwise parse output string
            const toolResult = event.result || (event.output ? (() => {
                try {
                    return JSON.parse(event.output);
                }
                catch {
                    return null;
                }
            })() : null);
            if (toolResult) {
                const summary = formatToolOutput(event.toolName, toolResult, event.duration);
                if (summary) {
                    // Claude Code style: subtle success indicator
                    console.log(chalk.gray(`    ${summary}`));
                }
            }
            toolDepth = Math.max(0, toolDepth - 1);
            break;
        case 'agent_start':
            // Claude Code style: subtle agent indicator, only show if not router
            if (event.agentName !== 'GateFlowRouter') {
                console.log();
                const handoffInfo = event.handoffFrom ? ` (from ${event.handoffFrom})` : '';
                console.log(chalk.gray(`  → ${event.agentName}${handoffInfo}`));
            }
            break;
        case 'agent_end':
            // Silent end
            break;
        case 'code_start':
            inCodeBlock = true;
            currentCodeFile = event.filePath;
            // Add visual separation before code block
            console.log();
            // Claude Code style: clean file header
            console.log(chalk.blue(`📝 ${event.filePath}`));
            break;
        case 'code_delta':
            if (inCodeBlock) {
                // Stream code content (buffered in dual-stream mode, so this shows complete content)
                process.stdout.write(chalk.white(event.content));
            }
            break;
        case 'code_end':
            if (inCodeBlock) {
                console.log(); // Add spacing after code block
                inCodeBlock = false;
                currentCodeFile = '';
            }
            break;
        case 'human_input_required':
            console.log();
            console.log(chalk.yellow.bold('⚠ Human Input Required'));
            console.log(chalk.yellow(`  Action: ${event.action}`));
            console.log(chalk.yellow(`  Details: ${event.details}`));
            if (event.options && event.options.length > 0) {
                console.log(chalk.yellow(`  Options: ${event.options.join(', ')}`));
            }
            break;
        case 'error':
            console.log();
            console.log(chalk.red.bold(`❌ Error: ${event.message}`));
            break;
        case 'tool_call_streaming':
            // Tool call streaming is buffered in dual-stream mode
            // Only used for debugging or if buffering fails
            // Don't display raw JSON fragments
            break;
        case 'message_created':
            // Message creation indicates text generation is starting/has started
            // Text is already streaming via stdout.write(), so no action needed
            // This event can fire after text has already started (SDK behavior)
            break;
        case 'response_delta':
            // Response deltas are handled by toTextStream() in dual-stream mode
            // Only render if not using dual-stream (fallback)
            break;
        case 'done':
            // Add spacing after completion (Claude Code style)
            if (currentLine && !currentLine.endsWith('\n')) {
                console.log();
            }
            console.log(); // Extra spacing for readability
            currentLine = '';
            break;
    }
}
/**
 * Format tool name for display
 */
function formatToolName(name) {
    // Handle undefined/null/empty
    if (!name || name === 'unknown' || name === 'tool') {
        return 'Processing...';
    }
    const nameMap = {
        // Agent tools (router delegates to these)
        'write_code': 'Generating code',
        'read_codebase': 'Analyzing codebase',
        'edit_code': 'Editing code',
        'lint_fix': 'Fixing errors',
        'generate_testbench': 'Creating testbench',
        'explain_code': 'Explaining code',
        // Function tools (used by agents)
        'read_file': 'Reading file',
        'write_file': 'Writing file',
        'list_files': 'Listing files',
        'scan_codebase': 'Scanning project',
        'lint_file': 'Checking syntax',
        'request_approval': 'Requesting approval',
        // Agent names that might appear as tool names
        'WriteCode': 'Generating code',
        'ReadCodebase': 'Analyzing codebase',
        'EditCode': 'Editing code',
        'LintFix': 'Fixing errors',
        'Testbench': 'Creating testbench',
        'Explain': 'Explaining code',
        // Function call formats
        'function_call': 'Processing',
        'function_call_output': 'Completed'
    };
    // Claude Code style: simple, action-oriented names
    if (nameMap[name]) {
        return nameMap[name];
    }
    // Try to make any tool name human-readable
    return name
        .replace(/([A-Z])/g, ' $1') // Add space before capitals
        .replace(/_/g, ' ') // Replace underscores with spaces
        .replace(/\b\w/g, l => l.toUpperCase()) // Capitalize first letters
        .trim();
}
/**
 * Format tool arguments for display (Claude Code style)
 * Extracts key fields and formats nicely, shows full JSON only in DEBUG
 */
function formatToolArguments(toolName, input) {
    if (!input || typeof input !== 'object')
        return '';
    // Try to extract meaningful info from common patterns
    const filePath = input.filePath || input.file_path || input.path;
    const dirPath = input.dirPath || input.dir_path || input.directory || input.dir;
    const query = input.query || input.input || input.prompt;
    const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
    switch (toolName.toLowerCase().replace(/_/g, '')) {
        case 'readfile':
        case 'lintfile':
        case 'read_file':
        case 'lint_file':
            return filePath ? `→ ${filePath}` : '';
        case 'writefile':
        case 'write_file':
            return filePath ? `→ ${filePath}` : '';
        case 'listfiles':
        case 'list_files':
        case 'scancodebase':
        case 'scan_codebase':
            return dirPath ? `→ ${dirPath}` : '';
        default:
            // Try to show any file/dir path found
            if (filePath)
                return `→ ${filePath}`;
            if (dirPath)
                return `→ ${dirPath}`;
            if (query && typeof query === 'string' && query.length < 50) {
                return `"${query}"`;
            }
            // In DEBUG mode, show full JSON
            if (DEBUG) {
                return JSON.stringify(input, null, 2).split('\n').slice(0, 3).join('\n    ');
            }
            return '';
    }
}
/**
 * Format tool output for display (Claude Code style)
 * Extracts success/error status, key metrics, formats with colors
 */
function formatToolOutput(toolName, output, duration) {
    if (!output)
        return '';
    const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
    const durationStr = duration ? ` (${duration}ms)` : '';
    // Handle error cases
    if (output.success === false || output.error) {
        return chalk.red(`✗ Failed: ${output.error || 'Unknown error'}${durationStr}`);
    }
    // Normalize tool name for matching
    const normalizedName = toolName.toLowerCase().replace(/_/g, '');
    switch (normalizedName) {
        case 'readfile':
            return output.lines
                ? chalk.green(`✓ Read ${output.lines} lines${durationStr}`)
                : chalk.green(`✓ Read file${durationStr}`);
        case 'writefile':
            return output.bytesWritten
                ? chalk.green(`✓ Wrote ${output.bytesWritten} bytes${durationStr}`)
                : chalk.green(`✓ File written${durationStr}`);
        case 'listfiles':
            return output.count
                ? chalk.green(`✓ Found ${output.count} items${durationStr}`)
                : chalk.green(`✓ Listed${durationStr}`);
        case 'scancodebase':
            const s = output.summary;
            return s
                ? chalk.green(`✓ Found ${s.modules} modules, ${s.testbenches} testbenches${durationStr}`)
                : chalk.green(`✓ Scanned${durationStr}`);
        case 'lintfile':
            if (output.errorCount !== undefined) {
                return output.errorCount > 0
                    ? chalk.yellow(`⚠ ${output.errorCount} errors, ${output.warningCount || 0} warnings${durationStr}`)
                    : chalk.green(`✓ Clean${durationStr}`);
            }
            return output.clean ? chalk.green(`✓ Clean${durationStr}`) : chalk.gray(`Checked${durationStr}`);
        default:
            // Generic success
            if (output.success === true)
                return chalk.green(`✓${durationStr}`);
            if (output.result) {
                const resultStr = String(output.result).substring(0, 50);
                return chalk.gray(`${resultStr}${durationStr}`);
            }
            return durationStr ? chalk.gray(durationStr) : '';
    }
}
/**
 * Clear the current line (for spinners, etc.)
 */
export function clearLine() {
    process.stdout.write('\r\x1b[K');
}
/**
 * Show a spinner with a message
 */
export function showSpinner(message) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    return setInterval(() => {
        clearLine();
        process.stdout.write(chalk.cyan(`${frames[i]} ${message}`));
        i = (i + 1) % frames.length;
    }, 80);
}
/**
 * Stop a spinner
 */
export function stopSpinner(interval, finalMessage) {
    clearInterval(interval);
    clearLine();
    if (finalMessage) {
        console.log(chalk.green(`✓ ${finalMessage}`));
    }
}
