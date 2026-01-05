/**
 * Synchronous Approval System
 * Uses readline-sync to avoid deadlock with async agent execution
 */
import readlineSync from 'readline-sync';
import chalk from 'chalk';
// Session-level approvals (auto-approve for rest of session)
const sessionApprovals = new Set();
let approveAll = false;
/**
 * Request synchronous approval from the user
 * This blocks the event loop but avoids the readline/async deadlock
 */
export function requestApprovalSync(action, details, options) {
    // Check if already approved for this action type
    if (approveAll || sessionApprovals.has(action)) {
        return { approved: true, scope: 'session' };
    }
    // Display approval request
    console.log('');
    console.log(chalk.yellow.bold('Approval Required'));
    console.log(chalk.white(`   ${action}: ${details}`));
    if (options?.diff) {
        console.log('');
        console.log(options.diff);
    }
    console.log('');
    // Synchronous prompt
    const answer = readlineSync.keyIn(chalk.gray('   [Y]es  [N]o  [A]ll  [S]kip: '), { limit: 'ynas', caseSensitive: false });
    console.log('');
    switch (answer.toLowerCase()) {
        case 'y':
            return { approved: true, scope: 'once' };
        case 'a':
            sessionApprovals.add(action);
            return { approved: true, scope: 'session' };
        case 'n':
        case 's':
        default:
            return { approved: false, scope: 'once' };
    }
}
/**
 * Auto-approve all operations for this session
 */
export function setApproveAll(value) {
    approveAll = value;
}
/**
 * Check if an action is already approved
 */
export function isApproved(action) {
    return approveAll || sessionApprovals.has(action);
}
/**
 * Clear all session approvals
 */
export function clearApprovals() {
    sessionApprovals.clear();
    approveAll = false;
}
/**
 * Auto-approve specific file patterns (e.g., SystemVerilog files)
 */
const AUTO_APPROVE_PATTERNS = [
    /\.sv$/i,
    /\.svh$/i,
    /\.v$/i,
    /\.vh$/i,
];
export function shouldAutoApprove(filePath) {
    return AUTO_APPROVE_PATTERNS.some(pattern => pattern.test(filePath));
}
