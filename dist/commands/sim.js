/**
 * Simulate command - Run Verilator simulation on a testbench
 */
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs/promises';
export async function simCommand(file, options) {
    const filePath = path.resolve(file);
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath, path.extname(filePath));
    console.log(chalk.cyan(`\n🚀 Simulating: ${filePath}\n`));
    // Convert to WSL path
    const wslPath = (p) => p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
    const wslDir = wslPath(dir);
    const wslFile = wslPath(filePath);
    // Step 1: Compile with Verilator
    const compileSpinner = ora('Compiling with Verilator...').start();
    try {
        // Generate harness if needed
        const isTestbench = basename.startsWith('tb_') || basename.includes('_tb');
        const harnessPath = path.join(dir, 'sim_main.cpp');
        const vcdPath = `${wslDir}/${basename}.vcd`;
        const harness = isTestbench ? `
#include "V${basename}.h"
#include "verilated.h"
#include "verilated_vcd_c.h"

int main(int argc, char** argv) {
    Verilated::commandArgs(argc, argv);
    const std::unique_ptr<VerilatedContext> contextp{new VerilatedContext};
    contextp->commandArgs(argc, argv);
    const std::unique_ptr<V${basename}> top{new V${basename}{contextp.get()}};
    
    Verilated::traceEverOn(true);
    VerilatedVcdC* tfp = new VerilatedVcdC;
    top->trace(tfp, 99);
    tfp->open("${vcdPath}");
    
    top->eval();
    tfp->dump(0);

    while (!contextp->gotFinish()) {
        contextp->timeInc(1);
        top->eval();
        tfp->dump(contextp->time());
    }
    
    tfp->close();
    return 0;
}
` : `
#include "V${basename}.h"
#include "verilated.h"
#include "verilated_vcd_c.h"

int main(int argc, char** argv) {
    Verilated::commandArgs(argc, argv);
    const std::unique_ptr<VerilatedContext> contextp{new VerilatedContext};
    const std::unique_ptr<V${basename}> top{new V${basename}{contextp.get()}};
    
    Verilated::traceEverOn(true);
    VerilatedVcdC* tfp = new VerilatedVcdC;
    top->trace(tfp, 99);
    tfp->open("${vcdPath}");
    
    top->clk = 0;
    top->reset = 1;

    for (int i = 0; i < 5; i++) {
        top->eval();
        tfp->dump(contextp->time());
        contextp->timeInc(1);
        top->clk = !top->clk;
    }
    top->reset = 0;

    while (!contextp->gotFinish() && contextp->time() < 20000) {
        top->eval();
        tfp->dump(contextp->time());
        contextp->timeInc(1);
        top->clk = !top->clk;
    }
    
    tfp->close();
    return 0;
}
`;
        await fs.writeFile(harnessPath, harness);
        // Compile
        const compileResult = await runWSL([
            'verilator', '-cc', wslFile,
            '--exe', wslPath(harnessPath),
            '--trace', '-Wno-fatal', '-Wno-DECLFILENAME',
            '--timing', '--top-module', basename
        ], dir);
        if (!compileResult.success) {
            compileSpinner.fail('Compilation failed');
            console.log(chalk.red('\n' + compileResult.output));
            return;
        }
        compileSpinner.succeed('Compiled successfully');
        // Step 2: Build
        const buildSpinner = ora('Building executable...').start();
        const buildResult = await runWSL([
            'make', '-C', `${wslDir}/obj_dir`,
            '-f', `V${basename}.mk`, `V${basename}`
        ], dir);
        if (!buildResult.success) {
            buildSpinner.fail('Build failed');
            console.log(chalk.red('\n' + buildResult.output));
            return;
        }
        buildSpinner.succeed('Built successfully');
        // Step 3: Run simulation
        const simSpinner = ora('Running simulation...').start();
        const simResult = await runWSL([`${wslDir}/obj_dir/V${basename}`], dir);
        simSpinner.succeed('Simulation complete');
        // Check for VCD file
        const windowsVcdPath = path.join(dir, `${basename}.vcd`);
        try {
            await fs.access(windowsVcdPath);
            console.log(chalk.green(`\n✅ VCD saved: ${windowsVcdPath}\n`));
        }
        catch {
            console.log(chalk.yellow('\n⚠ VCD file not found (simulation may have ended early)\n'));
        }
        if (simResult.output.trim()) {
            console.log(chalk.gray('Simulation output:'));
            console.log(simResult.output);
        }
    }
    catch (error) {
        compileSpinner.fail('Simulation failed');
        console.log(chalk.red(`\n❌ Error: ${error}\n`));
    }
}
function runWSL(args, cwd) {
    return new Promise((resolve) => {
        const proc = spawn('wsl', args, { cwd });
        let output = '';
        let errorOutput = '';
        proc.stdout.on('data', (data) => output += data.toString());
        proc.stderr.on('data', (data) => errorOutput += data.toString());
        proc.on('close', (code) => {
            resolve({
                success: code === 0,
                output: output + errorOutput
            });
        });
    });
}
