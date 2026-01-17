/**
 * GateFlow Health Checks
 * System health monitoring and status endpoints
 */

import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';

// ============================================================================
// Health Check Types
// ============================================================================

export type HealthState = 'healthy' | 'unhealthy' | 'degraded';

export interface HealthCheck {
    name: string;
    status: HealthState;
    message?: string;
    latencyMs?: number;
    lastCheck: number;
    metadata?: Record<string, unknown>;
}

export interface HealthStatus {
    status: HealthState;
    timestamp: number;
    uptime: number;
    version: string;
    checks: HealthCheck[];
    summary: string;
}

export type HealthCheckFn = () => Promise<HealthCheck>;

// ============================================================================
// Health Checker Implementation
// ============================================================================

export class HealthChecker {
    private checks = new Map<string, HealthCheckFn>();
    private lastStatus: HealthStatus | null = null;
    private startTime: number = Date.now();
    private version: string;

    constructor(version: string = '1.0.0') {
        this.version = version;
    }

    /**
     * Register a health check
     */
    registerCheck(name: string, check: HealthCheckFn): void {
        this.checks.set(name, check);
    }

    /**
     * Unregister a health check
     */
    unregisterCheck(name: string): void {
        this.checks.delete(name);
    }

    /**
     * Run all health checks
     */
    async check(): Promise<HealthStatus> {
        const checkResults: HealthCheck[] = [];
        let overallStatus: HealthState = 'healthy';

        for (const [name, checkFn] of this.checks) {
            try {
                const result = await checkFn();
                checkResults.push(result);

                // Update overall status
                if (result.status === 'unhealthy') {
                    overallStatus = 'unhealthy';
                } else if (result.status === 'degraded' && overallStatus === 'healthy') {
                    overallStatus = 'degraded';
                }
            } catch (error) {
                checkResults.push({
                    name,
                    status: 'unhealthy',
                    message: error instanceof Error ? error.message : String(error),
                    lastCheck: Date.now(),
                });
                overallStatus = 'unhealthy';
            }
        }

        const status: HealthStatus = {
            status: overallStatus,
            timestamp: Date.now(),
            uptime: Date.now() - this.startTime,
            version: this.version,
            checks: checkResults,
            summary: this.generateSummary(checkResults, overallStatus),
        };

        this.lastStatus = status;
        return status;
    }

    /**
     * Run a specific health check
     */
    async checkComponent(name: string): Promise<HealthCheck> {
        const checkFn = this.checks.get(name);
        if (!checkFn) {
            return {
                name,
                status: 'unhealthy',
                message: `Health check '${name}' not found`,
                lastCheck: Date.now(),
            };
        }

        try {
            return await checkFn();
        } catch (error) {
            return {
                name,
                status: 'unhealthy',
                message: error instanceof Error ? error.message : String(error),
                lastCheck: Date.now(),
            };
        }
    }

    /**
     * Get last health status (cached)
     */
    getLastStatus(): HealthStatus | null {
        return this.lastStatus;
    }

    /**
     * Get list of registered checks
     */
    getRegisteredChecks(): string[] {
        return [...this.checks.keys()];
    }

    private generateSummary(checks: HealthCheck[], status: HealthState): string {
        const healthy = checks.filter(c => c.status === 'healthy').length;
        const degraded = checks.filter(c => c.status === 'degraded').length;
        const unhealthy = checks.filter(c => c.status === 'unhealthy').length;

        if (status === 'healthy') {
            return `All ${checks.length} checks passing`;
        } else if (status === 'degraded') {
            return `${healthy} healthy, ${degraded} degraded, ${unhealthy} unhealthy`;
        } else {
            const failedNames = checks
                .filter(c => c.status === 'unhealthy')
                .map(c => c.name)
                .join(', ');
            return `${unhealthy} check(s) failing: ${failedNames}`;
        }
    }
}

// ============================================================================
// Pre-built Health Checks
// ============================================================================

/**
 * Create a Verilator health check
 */
export function verilatorCheck(): HealthCheckFn {
    return async (): Promise<HealthCheck> => {
        const startTime = Date.now();

        return new Promise((resolve) => {
            const process = spawn('verilator', ['--version'], {
                shell: true,
                timeout: 5000,
            });

            let output = '';
            let error = '';

            process.stdout?.on('data', (data) => {
                output += data.toString();
            });

            process.stderr?.on('data', (data) => {
                error += data.toString();
            });

            process.on('close', (code) => {
                const latencyMs = Date.now() - startTime;

                if (code === 0 && output) {
                    const versionMatch = output.match(/Verilator (\d+\.\d+)/);
                    resolve({
                        name: 'verilator',
                        status: 'healthy',
                        message: versionMatch ? `Version ${versionMatch[1]}` : 'Available',
                        latencyMs,
                        lastCheck: Date.now(),
                        metadata: { version: versionMatch?.[1] },
                    });
                } else {
                    resolve({
                        name: 'verilator',
                        status: 'unhealthy',
                        message: error || 'Verilator not found',
                        latencyMs,
                        lastCheck: Date.now(),
                    });
                }
            });

            process.on('error', (err) => {
                resolve({
                    name: 'verilator',
                    status: 'unhealthy',
                    message: err.message,
                    latencyMs: Date.now() - startTime,
                    lastCheck: Date.now(),
                });
            });
        });
    };
}

/**
 * Create a file system health check
 */
export function fileSystemCheck(path: string): HealthCheckFn {
    return async (): Promise<HealthCheck> => {
        const startTime = Date.now();

        try {
            await access(path, constants.R_OK | constants.W_OK);
            return {
                name: 'filesystem',
                status: 'healthy',
                message: `Path accessible: ${path}`,
                latencyMs: Date.now() - startTime,
                lastCheck: Date.now(),
                metadata: { path },
            };
        } catch (error) {
            return {
                name: 'filesystem',
                status: 'unhealthy',
                message: error instanceof Error ? error.message : 'Path not accessible',
                latencyMs: Date.now() - startTime,
                lastCheck: Date.now(),
                metadata: { path },
            };
        }
    };
}

/**
 * Create an API health check
 */
export function apiCheck(apiKey: string | undefined): HealthCheckFn {
    return async (): Promise<HealthCheck> => {
        const startTime = Date.now();

        if (!apiKey) {
            return {
                name: 'api',
                status: 'unhealthy',
                message: 'API key not configured',
                latencyMs: Date.now() - startTime,
                lastCheck: Date.now(),
            };
        }

        // Check if API key looks valid (starts with expected prefix)
        const isValidFormat = apiKey.startsWith('sk-ant-') || apiKey.length > 20;

        return {
            name: 'api',
            status: isValidFormat ? 'healthy' : 'degraded',
            message: isValidFormat ? 'API key configured' : 'API key format may be invalid',
            latencyMs: Date.now() - startTime,
            lastCheck: Date.now(),
            metadata: { keyPrefix: apiKey.slice(0, 7) + '...' },
        };
    };
}

/**
 * Create a memory health check
 */
export function memoryCheck(thresholdMB: number = 1024): HealthCheckFn {
    return async (): Promise<HealthCheck> => {
        const startTime = Date.now();
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(usage.rss / 1024 / 1024);

        let status: HealthState = 'healthy';
        let message = `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB, RSS: ${rssMB}MB`;

        if (heapUsedMB > thresholdMB) {
            status = 'unhealthy';
            message = `Memory usage exceeds threshold: ${heapUsedMB}MB > ${thresholdMB}MB`;
        } else if (heapUsedMB > thresholdMB * 0.8) {
            status = 'degraded';
            message = `Memory usage approaching threshold: ${heapUsedMB}MB / ${thresholdMB}MB`;
        }

        return {
            name: 'memory',
            status,
            message,
            latencyMs: Date.now() - startTime,
            lastCheck: Date.now(),
            metadata: {
                heapUsedMB,
                heapTotalMB,
                rssMB,
                thresholdMB,
            },
        };
    };
}

/**
 * Create a simple liveness check
 */
export function livenessCheck(): HealthCheckFn {
    return async (): Promise<HealthCheck> => {
        return {
            name: 'liveness',
            status: 'healthy',
            message: 'Process is alive',
            latencyMs: 0,
            lastCheck: Date.now(),
        };
    };
}

// ============================================================================
// Global Health Checker
// ============================================================================

let globalHealthChecker: HealthChecker | null = null;

/**
 * Initialize the global health checker with default checks
 */
export function initHealthChecker(
    projectRoot: string,
    version?: string
): HealthChecker {
    globalHealthChecker = new HealthChecker(version);

    // Register default checks
    globalHealthChecker.registerCheck('liveness', livenessCheck());
    globalHealthChecker.registerCheck('memory', memoryCheck());
    globalHealthChecker.registerCheck('filesystem', fileSystemCheck(projectRoot));
    globalHealthChecker.registerCheck('api', apiCheck(process.env.ANTHROPIC_API_KEY));
    globalHealthChecker.registerCheck('verilator', verilatorCheck());

    return globalHealthChecker;
}

/**
 * Get the global health checker
 */
export function getHealthChecker(): HealthChecker | null {
    return globalHealthChecker;
}

/**
 * Run global health check
 */
export async function runHealthCheck(): Promise<HealthStatus> {
    if (!globalHealthChecker) {
        throw new Error('Health checker not initialized');
    }
    return globalHealthChecker.check();
}

// ============================================================================
// CLI Health Command
// ============================================================================

/**
 * Format health status for CLI output
 */
export function formatHealthStatus(status: HealthStatus): string {
    const lines: string[] = [];

    // Header
    const statusIcon = status.status === 'healthy' ? '✓' :
                       status.status === 'degraded' ? '!' : '✗';
    lines.push(`${statusIcon} Health Status: ${status.status.toUpperCase()}`);
    lines.push(`  Version: ${status.version}`);
    lines.push(`  Uptime: ${formatUptime(status.uptime)}`);
    lines.push('');

    // Checks
    lines.push('Checks:');
    for (const check of status.checks) {
        const icon = check.status === 'healthy' ? '✓' :
                     check.status === 'degraded' ? '!' : '✗';
        const latency = check.latencyMs !== undefined ? ` (${check.latencyMs}ms)` : '';
        lines.push(`  ${icon} ${check.name}: ${check.status}${latency}`);
        if (check.message) {
            lines.push(`    ${check.message}`);
        }
    }

    lines.push('');
    lines.push(`Summary: ${status.summary}`);

    return lines.join('\n');
}

function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}
