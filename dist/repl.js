/**
 * Interactive REPL for GateFlow CLI
 * Provides Claude Code-like natural language experience
 */
import readline from 'readline';
import chalk from 'chalk';
import { executeQueryDual, initializeAgents } from './agents/index.js';
import { renderEvent, showSpinner, stopSpinner } from './renderer.js';
// Minimal commands - everything else is natural language
const COMMANDS = {
    '/help': {
        description: 'Show help',
        handler: () => {
            console.log(chalk.cyan('\n  GateFlow - AI-powered SystemVerilog assistant\n'));
            console.log(chalk.gray('  Just type naturally - no commands needed!\n'));
            console.log(chalk.white('  Examples:'));
            console.log(chalk.gray('    "make me a 4-bit counter"'));
            console.log(chalk.gray('    "read the files in src/"'));
            console.log(chalk.gray('    "add a reset signal to counter.sv"'));
            console.log(chalk.gray('    "fix the errors in adder.sv"'));
            console.log(chalk.gray('    "generate a testbench for counter"'));
            console.log(chalk.gray('    "what does this module do?"\n'));
            console.log(chalk.white('  Commands:'));
            console.log(chalk.gray('    /help   - Show this help'));
            console.log(chalk.gray('    /clear  - Clear screen'));
            console.log(chalk.gray('    /exit   - Exit\n'));
        }
    },
    '/clear': {
        description: 'Clear the screen',
        handler: () => {
            console.clear();
        }
    },
    '/exit': {
        description: 'Exit the CLI',
        handler: () => {
            console.log(chalk.gray('\nGoodbye! 👋\n'));
            process.exit(0);
        }
    }
};
/**
 * Create a human-in-the-loop handler that uses the REPL
 */
function createHumanInLoopHandler(rl) {
    return {
        askUser: (prompt, options) => {
            return new Promise((resolve) => {
                console.log(); // New line
                if (options && options.length > 0) {
                    console.log(chalk.yellow(prompt));
                    options.forEach((opt, i) => {
                        console.log(chalk.gray(`  ${i + 1}. ${opt}`));
                    });
                    rl.question(chalk.yellow('Choose (number or type response): '), (answer) => {
                        const num = parseInt(answer, 10);
                        if (!isNaN(num) && num >= 1 && num <= options.length) {
                            resolve(options[num - 1]);
                        }
                        else {
                            resolve(answer);
                        }
                    });
                }
                else {
                    rl.question(chalk.yellow(`${prompt} `), (answer) => {
                        resolve(answer);
                    });
                }
            });
        }
    };
}
/**
 * Start the interactive REPL
 */
export async function startRepl(projectPath) {
    // Check for Anthropic API key (this CLI only uses Anthropic)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.log(chalk.red('\n❌ ANTHROPIC_API_KEY not found in environment.\n'));
        console.log(chalk.gray('This CLI uses Anthropic Claude Sonnet 4.5 exclusively.\n'));
        console.log(chalk.gray('Set it with:'));
        console.log(chalk.white('  export ANTHROPIC_API_KEY=sk-ant-...\n'));
        console.log(chalk.gray('Or add it to your .env file.\n'));
        process.exit(1);
    }
    // Initialize agents (Anthropic only)
    try {
        await initializeAgents(apiKey);
    }
    catch (error) {
        console.error(chalk.red(`\n❌ Failed to initialize agents: ${error.message}\n`));
        process.exit(1);
    }
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.cyan('\n❯ ')
    });
    const ctx = {
        projectPath,
        model: 'claude-sonnet-4-5', // Anthropic Claude Sonnet 4.5
        rl,
        history: []
    };
    const humanInLoop = createHumanInLoopHandler(rl);
    // Show welcome message
    console.log(chalk.gray(`\n  Project: ${projectPath}`));
    console.log(chalk.gray(`  Model: ${ctx.model}`));
    console.log(chalk.gray('  Type /help for commands, or just ask naturally.\n'));
    rl.prompt();
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
        // Check for slash commands
        if (input.startsWith('/')) {
            const [cmd] = input.split(' ');
            const command = COMMANDS[cmd];
            if (command) {
                command.handler(ctx);
            }
            else {
                console.log(chalk.red(`Unknown command: ${cmd}. Type /help for help.\n`));
            }
            rl.prompt();
            return;
        }
        // Natural language query - send to agents
        ctx.history.push(input);
        // Show thinking spinner
        const spinner = showSpinner('Thinking...');
        let spinnerStopped = false;
        // INVESTIGATION: Log when query starts
        if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') {
            console.error(`[DEBUG] Query started: "${input}"`);
            console.error(`[DEBUG] stdout.isTTY: ${process.stdout.isTTY}`);
        }
        try {
            // Use dual-stream for Claude Code-like experience
            await executeQueryDual(input, (event) => {
                // Stop spinner on first event
                if (!spinnerStopped) {
                    stopSpinner(spinner);
                    spinnerStopped = true;
                    // Don't add newline here - text stream handles it
                }
                renderEvent(event);
            }, humanInLoop);
        }
        catch (error) {
            if (!spinnerStopped) {
                stopSpinner(spinner);
            }
            // Handle Anthropic adapter validation errors gracefully
            if (Array.isArray(error) && error.some((e) => e?.code === 'invalid_type' && e?.path?.some((p) => p.includes('usage')))) {
                console.log(chalk.yellow('\n⚠️  Warning: Anthropic adapter compatibility issue (usage token validation).\n'));
                console.log(chalk.gray('The response was processed, but token usage validation failed.\n'));
            }
            else {
                const errorMsg = error?.message || (Array.isArray(error) ? JSON.stringify(error, null, 2) : String(error));
                console.log(chalk.red(`\n❌ Error: ${errorMsg}\n`));
            }
        }
        console.log(); // Add spacing after response
        rl.prompt();
    });
    rl.on('close', () => {
        console.log(chalk.gray('\nGoodbye! 👋\n'));
        process.exit(0);
    });
    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
        console.log(chalk.gray('\n\nInterrupted. Type /exit to quit.\n'));
        rl.prompt();
    });
}
