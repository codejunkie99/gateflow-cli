/**
 * Refactoring Agent
 * Modifies existing code with constraints
 * Uses AI SDK 6 Agent interface with edit tools
 */
import { createAgent } from './agentFactory.js';
/**
 * Create refactoring agent with edit tools
 */
export function createRefactoringAgent(tools) {
    return createAgent({
        name: 'refactoring',
        role: 'Code Refactoring Specialist',
        expertise: 'modifying existing code while preserving behavior',
        constraints: [
            'Preserve module interfaces unless explicitly asked to change',
            'Make minimal, targeted changes',
            'Keep naming consistent - do not rename unless requested',
            'Preserve behavioral intent',
            'Use edit_lines or search_replace for precise edits',
            'Maintain compilation order dependencies'
        ],
        tools: {
            read_file: tools.read_file,
            edit_lines: tools.edit_lines,
            search_replace: tools.search_replace,
            find_module: tools.find_module,
            get_dependencies: tools.get_dependencies,
            search_code: tools.search_code
        },
        maxSteps: 12
    });
}
