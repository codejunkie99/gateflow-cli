/**
 * Lint command - Run Verilator linting on a SystemVerilog file
 */
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { spawn } from 'child_process';
/**
 * Convert Windows path to WSL path
 */
function convertToWSLPath(windowsPath) {
    const normalized = windowsPath.replace(/\\/g, '/');
    const match = normalized.match(/^([A-Z]):(\/.*)/i);
    if (match) {
        const [, drive, rest] = match;
        return `/mnt/${drive.toLowerCase()}${rest}`;
    }
    return normalized;
}
/**
 * Parse Verilator output to extract errors
 */
function parseVerilatorErrors(output) {
    const errors = [];
    const lines = output.replace(/\u001b\[\d+m/g, '').split('\n');
    for (const line of lines) {
        const match = line.match(/%(\w+):\s+([^:]+):(\d+)(?::(\d+))?: (.+)/);
        if (match) {
            const [, severity, file, lineNum, colNum, message] = match;
            errors.push({
                line: parseInt(lineNum, 10),
                column: colNum ? parseInt(colNum, 10) : undefined,
                message: message.trim(),
                severity: severity.toLowerCase() === 'error' ? 'error' : 'warning',
                file
            });
        }
    }
    return errors;
}
/**
 * Run lint using Verilator via WSL
 */
async function lintFile(filePath) {
    const absolutePath = path.resolve(filePath);
    const wslPath = convertToWSLPath(absolutePath);
    const includeDir = convertToWSLPath(path.dirname(absolutePath));
    const args = [
        'verilator',
        '--lint-only',
        '-Wall',
        '-Wno-fatal',
        '-Wno-DECLFILENAME',
        '-Wno-EOFNEWLINE',
        `-I${includeDir}`,
        wslPath
    ];
    return new Promise((resolve) => {
        const proc = spawn('wsl', args);
        let output = '';
        let errorOutput = '';
        proc.stdout.on('data', (data) => output += data.toString());
        proc.stderr.on('data', (data) => errorOutput += data.toString());
        proc.on('close', (code) => {
            const fullOutput = output + errorOutput;
            const errors = parseVerilatorErrors(fullOutput);
            const errorCount = errors.filter(e => e.severity === 'error').length;
            const warningCount = errors.filter(e => e.severity === 'warning').length;
            resolve({
                success: code === 0 && errorCount === 0,
                errors,
                errorCount,
                warningCount,
                output: fullOutput
            });
        });
        proc.on('error', (error) => {
            resolve({
                success: false,
                errors: [{
                        line: 0,
                        message: `Failed to run Verilator: ${error.message}`,
                        severity: 'error',
                        file: filePath
                    }],
                errorCount: 1,
                warningCount: 0,
                output: `Error: ${error.message}`
            });
        });
    });
}
export async function lintCommand(file) {
    const filePath = path.resolve(file);
    console.log(chalk.cyan(`\n🔍 Linting: ${filePath}\n`));
    const spinner = ora('Running Verilator...').start();
    try {
        const result = await lintFile(filePath);
        spinner.stop();
        if (result.success) {
            console.log(chalk.green('✅ No errors found!\n'));
            if (result.warningCount > 0) {
                console.log(chalk.yellow(`⚠ ${result.warningCount} warning(s)\n`));
                for (const error of result.errors.filter(e => e.severity === 'warning')) {
                    console.log(chalk.yellow(`  ⚠️ Line ${error.line}: ${error.message}`));
                }
                console.log();
            }
        }
        else {
            console.log(chalk.red(`❌ Found ${result.errorCount} error(s), ${result.warningCount} warning(s):\n`));
            for (const error of result.errors) {
                const icon = error.severity === 'error' ? '❌' : '⚠️';
                const color = error.severity === 'error' ? chalk.red : chalk.yellow;
                console.log(color(`  ${icon} Line ${error.line}: ${error.message}`));
            }
            console.log();
        }
        if (result.output && process.env.DEBUG) {
            console.log(chalk.gray('Raw output:'));
            console.log(chalk.gray(result.output));
        }
    }
    catch (error) {
        spinner.stop();
        console.log(chalk.red(`\n❌ Error: ${error}\n`));
    }
}
