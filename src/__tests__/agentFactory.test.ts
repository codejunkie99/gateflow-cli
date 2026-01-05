/**
 * Agent Factory Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { createAgent } from '../agent/specialized/agentFactory.js';
import { z } from 'zod';

describe('Agent Factory', () => {
    it('should create agent with required fields', () => {
        const agent = createAgent({
            name: 'test',
            role: 'Test Role',
            expertise: 'testing',
            constraints: ['Constraint 1'],
            tools: {}
        });

        expect(agent.name).toBe('test');
        expect(agent.system).toContain('Test Role');
        expect(agent.system).toContain('testing');
        expect(agent.toolChoice).toBe('auto');
        expect(agent.maxSteps).toBe(10);
    });

    it('should use custom maxSteps', () => {
        const agent = createAgent({
            name: 'test',
            role: 'Test',
            expertise: 'test',
            constraints: [],
            tools: {},
            maxSteps: 20
        });

        expect(agent.maxSteps).toBe(20);
    });

    it('should include constraints in system prompt', () => {
        const agent = createAgent({
            name: 'test',
            role: 'Test',
            expertise: 'test',
            constraints: ['Must do X', 'Must not do Y'],
            tools: {}
        });

        expect(agent.system).toContain('Must do X');
        expect(agent.system).toContain('Must not do Y');
    });
});

