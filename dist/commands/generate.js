/**
 * Generate command - Generate SystemVerilog code from natural language
 */
import chalk from 'chalk';
import ora from 'ora';
import { executeQuery, initializeAgents } from '../agents/index.js';
import { renderEvent } from '../renderer.js';
export async function generateCommand(spec, options) {
    const projectPath = process.cwd();
    console.log(chalk.cyan(`\n🔧 Generating code from specification...\n`));
    console.log(chalk.gray(`Spec: "${spec}"\n`));
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.log(chalk.red('❌ ANTHROPIC_API_KEY not set. Please set it in your environment or .env file.\n'));
        console.log(chalk.gray('This CLI uses Anthropic Claude Sonnet 4.5 exclusively.\n'));
        return;
    }
    // Initialize agents (Anthropic only)
    await initializeAgents(apiKey);
    // Build the request
    let request = spec;
    if (options.output) {
        request += `\n\nSave the code to file: ${options.output}`;
    }
    if (options.tb) {
        request += '\n\nAlso generate a testbench for this module.';
    }
    const spinner = ora({
        text: 'Generating...',
        color: 'cyan'
    }).start();
    let spinnerStopped = false;
    try {
        await executeQuery(request, (event) => {
            if (!spinnerStopped) {
                spinner.stop();
                spinnerStopped = true;
            }
            renderEvent(event);
        });
        console.log(chalk.green('\n✅ Generation complete!\n'));
    }
    catch (error) {
        if (!spinnerStopped) {
            spinner.stop();
        }
        console.log(chalk.red(`\n❌ Error: ${error}\n`));
    }
}
