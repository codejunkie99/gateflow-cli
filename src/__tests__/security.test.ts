/**
 * Security Tests
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventBus } from '../events/bus.js';
import { PolicyEngine } from '../approval/engine.js';
import { FileTools } from '../fileops/file.js';

describe('Security', () => {
    it('blocks path traversal in file operations', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gateflow-root-'));
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gateflow-outside-'));

        const bus = new EventBus();
        const policy = new PolicyEngine({ projectRoot });
        const fileTools = new FileTools(bus, policy, projectRoot);

        const result = await fileTools.listFiles(outsideDir);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/outside project root|path traversal/i);
    });

    it('blocks path traversal in MCP executor', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gateflow-mcp-root-'));
        const outsideFile = path.join(path.dirname(projectRoot), 'outside.txt');
        await fs.writeFile(outsideFile, 'test', 'utf-8');

        const { createToolExecutor } = await import('../../packages/claude-plugin/servers/gateflow-mcp/src/executor.js');
        const executor = createToolExecutor(projectRoot);

        await expect(
            executor.execute('read_file', { path: '../outside.txt' })
        ).rejects.toThrow(/outside project root|path traversal/i);
    });

    it('uses execFile args for jq execution', async () => {
        vi.resetModules();

        const execFileMock = vi.fn((cmd: string, args: string[], options: any, cb?: any) => {
            const callback = typeof options === 'function' ? options : cb;
            callback?.(null, '{"ok":true}', '');
        });

        vi.doMock('node:child_process', () => ({
            execFile: execFileMock
        }));

        const { DynamicContextManager } = await import('../context/DynamicContextManager.js');

        const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gateflow-context-'));
        const manager = new DynamicContextManager(null, { baseDir, projectId: 'proj' });
        await manager.initialize();

        const contextDir = path.join(baseDir, 'proj', 'context');
        const samplePath = path.join(contextDir, 'sample.json');
        await fs.writeFile(samplePath, JSON.stringify({ ok: true }), 'utf-8');

        await manager.jq('sample.json', '.ok');

        expect(execFileMock).toHaveBeenCalled();
        const callArgs = execFileMock.mock.calls[0]?.[1];
        expect(Array.isArray(callArgs)).toBe(true);
        expect(callArgs).toEqual(['--', '.ok', samplePath]);

        vi.resetModules();
        vi.restoreAllMocks();
    });

    it('uses execFile args for MCP lint_file', async () => {
        vi.resetModules();

        const execFileMock = vi.fn((cmd: string, args: string[], options: any, cb?: any) => {
            const callback = typeof options === 'function' ? options : cb;
            callback?.(null, 'ok', '');
        });

        vi.doMock('node:child_process', () => ({
            execFile: execFileMock,
            spawn: vi.fn(),
        }));

        const { createToolExecutor } = await import('../../packages/claude-plugin/servers/gateflow-mcp/src/executor.js');
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gateflow-mcp-lint-'));
        const executor = createToolExecutor(projectRoot);

        await executor.execute('lint_file', { path: 'test.sv' });

        expect(execFileMock).toHaveBeenCalled();
        const callArgs = execFileMock.mock.calls[0]?.[1];
        expect(Array.isArray(callArgs)).toBe(true);
        expect(callArgs).toEqual(expect.arrayContaining(['--lint-only', '-Wall']));

        vi.resetModules();
        vi.restoreAllMocks();
    });
});
