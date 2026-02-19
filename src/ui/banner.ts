import chalk from 'chalk';

const BANNER_LINES = [
    chalk.blue.bold('  ██████╗  █████╗ ████████╗███████╗███████╗██╗      ██████╗ ██╗    ██╗'),
    chalk.blue.bold(' ██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██╔════╝██║     ██╔═══██╗██║    ██║'),
    chalk.blue.bold(' ██║  ███╗███████║   ██║   █████╗  █████╗  ██║     ██║   ██║██║ █╗ ██║'),
    chalk.blue.bold(' ██║   ██║██╔══██║   ██║   ██╔══╝  ██╔══╝  ██║     ██║   ██║██║███╗██║'),
    chalk.blue.bold(' ╚██████╔╝██║  ██║   ██║   ███████╗██║     ███████╗╚██████╔╝╚███╔███╔╝'),
    chalk.blue.bold('  ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝'),
    chalk.cyan('                Founded & Built by Avidlive (Av1dlive) '),
    chalk.cyan('             Founding Contributor - Manas (Menace_thakur) '),
    chalk.cyan('                AI-powered SystemVerilog Assistant')
];

export function getBannerLines(): string[] {
    return [...BANNER_LINES];
}

function getBanner(): string {
    return `\n${BANNER_LINES.join('\n')}\n`;
}
