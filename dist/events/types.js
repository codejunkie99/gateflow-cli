/**
 * GateFlow Event Protocol
 * Unified typed event bus for renderer decoupling
 */
// ============================================================================
// Event Type Guards
// ============================================================================
export function isTokenEvent(event) {
    return event.type === 'token';
}
export function isStatusEvent(event) {
    return event.type === 'status';
}
export function isToolEvent(event) {
    return event.type === 'tool_call' || event.type === 'tool_result';
}
export function isApprovalEvent(event) {
    return event.type === 'approval_request' || event.type === 'approval_response';
}
export function isErrorEvent(event) {
    return event.type === 'error';
}
// ============================================================================
// Exit Codes
// ============================================================================
export const ExitCodes = {
    SUCCESS: 0,
    LINT_FAILED: 1,
    USER_REJECTED: 2,
    TOOL_ERROR: 3,
    CONFIG_ERROR: 4,
    NETWORK_ERROR: 5,
    TIMEOUT: 6,
    WATCH_ERROR: 7,
};
