/**
 * Orchestrator task flow tests
 */

import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../agent/orchestrator/Orchestrator.js';
import { EventBus } from '../events/bus.js';
import type {
    ExecutionPlan,
    ProjectContext,
    Task,
    TaskContext,
    TaskResult
} from '../types/agent-shared.js';

const buildTask = (id: string, agent: Task['agent'], dependencies: string[] = []): Task => ({
    id,
    type: 'analyze',
    description: `Task ${id}`,
    priority: 'medium',
    dependencies,
    agent
});

const buildResult = (taskId: string, agent: Task['agent']): TaskResult => ({
    taskId,
    agent,
    success: true,
    output: `Output ${taskId}`,
    summary: `Summary ${taskId}`,
    artifacts: {
        filesCreated: [],
        filesModified: [],
        modulesFound: [],
        errorsDetected: []
    },
    insights: [],
    durationMs: 10
});

describe('Orchestrator task flow', () => {
    it('buildTaskContext uses dependency results only', () => {
        const bus = new EventBus();
        const orchestrator = new Orchestrator(bus, 'C:/repo', 'test-model');

        const taskA = buildTask('A', 'understanding');
        const taskB = buildTask('B', 'codegen', ['A']);
        const taskC = buildTask('C', 'debug');

        const projectContext: ProjectContext = {
            projectRoot: 'C:/repo',
            modules: [],
            dependencies: { topModules: [], leafModules: [], totalModules: 0 }
        };

        const plan: ExecutionPlan = {
            planType: 'multi_file',
            tasks: [taskA, taskB, taskC],
            estimatedSteps: 3,
            confidence: 0.9
        };

        const ctx = {
            taskResults: new Map<string, TaskResult>([
                ['A', buildResult('A', 'understanding')],
                ['C', buildResult('C', 'debug')]
            ])
        } as any;

        const context = (orchestrator as any).buildTaskContext(
            ctx,
            taskB,
            projectContext,
            plan
        ) as TaskContext;

        expect([...context.previousResults.keys()]).toEqual(['A']);
        expect(context.orchestrationState.completedTasks).toBe(2);
        expect(context.orchestrationState.failedTasks).toEqual([]);
    });

    it('summarizeOutput trims long output but keeps key lines', () => {
        const bus = new EventBus();
        const orchestrator = new Orchestrator(bus, 'C:/repo', 'test-model');

        const longOutput = [
            'module foo;',
            'generated foo.sv',
            'error: bad thing happened',
            ...Array.from({ length: 2000 }, (_, i) => `line ${i}`)
        ].join('\n');

        const summary = (orchestrator as any).summarizeOutput(longOutput, 'generate') as string;

        expect(summary.length).toBeLessThan(longOutput.length);
        expect(summary).toMatch(/module foo/);
        expect(summary).toMatch(/generated foo\.sv/);
    });

    it('extractArtifacts finds files, modules, and errors', () => {
        const bus = new EventBus();
        const orchestrator = new Orchestrator(bus, 'C:/repo', 'test-model');

        const output = [
            'created src/foo.sv',
            'modified bar.v',
            'module top',
            'Error: bad stuff'
        ].join('\n');

        const artifacts = (orchestrator as any).extractArtifacts(output) as TaskResult['artifacts'];

        expect(artifacts.filesCreated).toContain('src/foo.sv');
        expect(artifacts.filesModified).toEqual(expect.arrayContaining(['src/foo.sv', 'bar.v']));
        expect(artifacts.modulesFound).toContain('top');
        expect(artifacts.errorsDetected[0]).toContain('bad stuff');
    });

    it('groupTasksByLevel respects dependencies', () => {
        const bus = new EventBus();
        const orchestrator = new Orchestrator(bus, 'C:/repo', 'test-model');

        const tasks = [
            buildTask('A', 'understanding'),
            buildTask('B', 'codegen', ['A']),
            buildTask('C', 'testbench', ['A']),
            buildTask('D', 'debug', ['B'])
        ];

        const levels = (orchestrator as any).groupTasksByLevel(tasks) as Task[][];

        expect(levels.length).toBe(3);
        expect(levels[0].map(task => task.id)).toEqual(['A']);
        expect(levels[1].map(task => task.id).sort()).toEqual(['B', 'C']);
        expect(levels[2].map(task => task.id)).toEqual(['D']);
    });

    it('groupTasksByLevel rejects circular dependencies', () => {
        const bus = new EventBus();
        const orchestrator = new Orchestrator(bus, 'C:/repo', 'test-model');

        const tasks = [
            buildTask('A', 'understanding', ['B']),
            buildTask('B', 'codegen', ['A'])
        ];

        expect(() => (orchestrator as any).groupTasksByLevel(tasks)).toThrow(/Circular dependency/);
    });
});
