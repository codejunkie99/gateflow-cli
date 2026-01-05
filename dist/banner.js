/**
 * CLI Banner and startup messages
 */
import chalk from 'chalk';
const BANNER_FULL = `
   ██████╗  █████╗ ████████╗███████╗███████╗██╗      ██████╗ ██╗    ██╗
  ██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██╔════╝██║     ██╔═══██╗██║    ██║
  ██║  ███╗███████║   ██║   █████╗  █████╗  ██║     ██║   ██║██║ █╗ ██║
  ██║   ██║██╔══██║   ██║   ██╔══╝  ██╔══╝  ██║     ██║   ██║██║███╗██║
  ╚██████╔╝██║  ██║   ██║   ███████╗██║     ███████╗╚██████╔╝╚███╔███╔╝
   ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ 
`;
const BANNER_COMPACT = `
  ╔═══════════════════════════════════════════════════════════╗
  ║  GateFlow - AI-powered SystemVerilog/Verilog Assistant    ║
  ╚═══════════════════════════════════════════════════════════╝
`;
/**
 * Print the startup banner
 */
export function printBanner(compact = false) {
    if (compact) {
        console.log(chalk.cyan(BANNER_COMPACT));
    }
    else {
        console.log(chalk.cyan(BANNER_FULL));
    }
}
/**
 * Print startup info
 */
export function printStartupInfo(projectPath, model) {
    console.log(chalk.gray('  AI-powered HDL development from the terminal\n'));
    console.log(chalk.white('  Examples:'));
    console.log(chalk.gray('    "make me a 4-bit counter"'));
    console.log(chalk.gray('    "read the files in src/"'));
    console.log(chalk.gray('    "add a reset signal to counter.sv"'));
    console.log(chalk.gray('    "fix the errors in adder.sv"'));
    console.log(chalk.gray('    "generate a testbench for counter"\n'));
}
