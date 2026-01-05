/**
 * AI Tool Definitions
 * Tools for the Vercel AI SDK agent
 */
import { z } from 'zod';
import type { EventBus } from '../events/index.js';
import type { PolicyEngine } from '../policy/index.js';
import type { FileTools, EditTools } from '../tools/index.js';
import type { ProjectIndexer } from '../context/index.js';
import type { DiffEngine } from '../diff/index.js';
import type { Verilator } from '../verification/verilator.js';
export interface ToolContext {
    bus: EventBus;
    policy: PolicyEngine;
    fileTools: FileTools;
    editTools: EditTools;
    indexer: ProjectIndexer;
    diffEngine: DiffEngine;
    verilator?: Verilator;
    projectRoot: string;
    dryRun: boolean;
    autoApprove: boolean;
}
export declare const readFileSchema: z.ZodObject<{
    path: z.ZodString;
    startLine: z.ZodOptional<z.ZodNumber>;
    endLine: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    path: string;
    startLine?: number | undefined;
    endLine?: number | undefined;
}, {
    path: string;
    startLine?: number | undefined;
    endLine?: number | undefined;
}>;
export declare const writeFileSchema: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    content: string;
}, {
    path: string;
    content: string;
}>;
export declare const editLinesSchema: z.ZodObject<{
    path: z.ZodString;
    edits: z.ZodArray<z.ZodObject<{
        startLine: z.ZodNumber;
        endLine: z.ZodNumber;
        newContent: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        startLine: number;
        endLine: number;
        newContent: string;
    }, {
        startLine: number;
        endLine: number;
        newContent: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    path: string;
    edits: {
        startLine: number;
        endLine: number;
        newContent: string;
    }[];
}, {
    path: string;
    edits: {
        startLine: number;
        endLine: number;
        newContent: string;
    }[];
}>;
export declare const searchReplaceSchema: z.ZodObject<{
    path: z.ZodString;
    search: z.ZodString;
    replace: z.ZodString;
    all: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    isRegex: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    all: boolean;
    replace: string;
    search: string;
    path: string;
    isRegex: boolean;
}, {
    replace: string;
    search: string;
    path: string;
    all?: boolean | undefined;
    isRegex?: boolean | undefined;
}>;
export declare const listFilesSchema: z.ZodObject<{
    directory: z.ZodString;
    extensions: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    recursive: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    directory: string;
    extensions: string[];
    recursive: boolean;
}, {
    directory: string;
    extensions?: string[] | undefined;
    recursive?: boolean | undefined;
}>;
export declare const searchCodeSchema: z.ZodObject<{
    pattern: z.ZodString;
    filePattern: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    caseSensitive: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    maxResults: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    caseSensitive: boolean;
    pattern: string;
    filePattern: string;
    maxResults: number;
}, {
    pattern: string;
    caseSensitive?: boolean | undefined;
    filePattern?: string | undefined;
    maxResults?: number | undefined;
}>;
export declare const findModuleSchema: z.ZodObject<{
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
}, {
    name: string;
}>;
export declare const getDependenciesSchema: z.ZodObject<{
    module: z.ZodString;
}, "strip", z.ZodTypeAny, {
    module: string;
}, {
    module: string;
}>;
export declare const lintFileSchema: z.ZodObject<{
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
}, {
    path: string;
}>;
export declare const runSimSchema: z.ZodObject<{
    top: z.ZodString;
    testbench: z.ZodOptional<z.ZodString>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    top: string;
    testbench?: string | undefined;
    timeout?: number | undefined;
}, {
    top: string;
    testbench?: string | undefined;
    timeout?: number | undefined;
}>;
export declare const findAllSvFilesSchema: z.ZodObject<{
    directory: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    directory: string;
}, {
    directory?: string | undefined;
}>;
export declare function createToolExecutors(ctx: ToolContext): {
    read_file: (args: z.infer<typeof readFileSchema>) => Promise<{
        error: string | undefined;
        path?: undefined;
        content?: undefined;
        lines?: undefined;
    } | {
        path: string;
        content: string | undefined;
        lines: number | undefined;
        error?: undefined;
    }>;
    write_file: (args: z.infer<typeof writeFileSchema>) => Promise<{
        dryRun: boolean;
        diff: string;
        error?: undefined;
        path?: undefined;
        created?: undefined;
        bytesWritten?: undefined;
    } | {
        error: string | undefined;
        dryRun?: undefined;
        diff?: undefined;
        path?: undefined;
        created?: undefined;
        bytesWritten?: undefined;
    } | {
        path: string;
        created: boolean | undefined;
        bytesWritten: number | undefined;
        dryRun?: undefined;
        diff?: undefined;
        error?: undefined;
    }>;
    edit_lines: (args: z.infer<typeof editLinesSchema>) => Promise<{
        error: string | undefined;
        path?: undefined;
        applied?: undefined;
        stats?: undefined;
    } | {
        path: string;
        applied: boolean | undefined;
        stats: {
            added: number;
            removed: number;
        } | undefined;
        error?: undefined;
    }>;
    search_replace: (args: z.infer<typeof searchReplaceSchema>) => Promise<{
        error: string | undefined;
        path?: undefined;
        replacements?: undefined;
        applied?: undefined;
    } | {
        path: string;
        replacements: number;
        applied: boolean | undefined;
        error?: undefined;
    }>;
    list_files: (args: z.infer<typeof listFilesSchema>) => Promise<{
        directory: string;
        count: number;
        files: never[];
        note: string;
        error?: undefined;
    } | {
        error: string | undefined;
        directory?: undefined;
        count?: undefined;
        files?: undefined;
        note?: undefined;
    } | {
        directory: string;
        count: number;
        files: {
            name: string;
            type: "file" | "directory";
            size: number | undefined;
        }[];
        note?: undefined;
        error?: undefined;
    }>;
    search_code: (args: z.infer<typeof searchCodeSchema>) => Promise<{
        error: string | undefined;
        pattern?: undefined;
        totalMatches?: undefined;
        matches?: undefined;
    } | {
        pattern: string;
        totalMatches: number;
        matches: {
            file: string;
            line: number;
            content: string;
        }[];
        error?: undefined;
    }>;
    find_module: (args: z.infer<typeof findModuleSchema>) => Promise<{
        error: string;
        name?: undefined;
        file?: undefined;
        line?: undefined;
        ports?: undefined;
        parameters?: undefined;
        instantiates?: undefined;
    } | {
        name: string;
        file: string;
        line: number;
        ports: import("../context/parser.js").PortInfo[];
        parameters: import("../context/parser.js").ParameterInfo[];
        instantiates: string[];
        error?: undefined;
    }>;
    get_dependencies: (args: z.infer<typeof getDependenciesSchema>) => Promise<{
        topModule: string;
        compilationOrder: string[];
        missing: string[];
        cycles: string[][];
        nodeCount: number;
    }>;
    lint_file: (args: z.infer<typeof lintFileSchema>) => Promise<{
        error: string;
        success?: undefined;
        errors?: undefined;
        warnings?: undefined;
    } | {
        success: boolean;
        errors: import("../verification/verilator.js").LintError[];
        warnings: import("../verification/verilator.js").LintError[];
        error?: undefined;
    }>;
    run_simulation: (args: z.infer<typeof runSimSchema>) => Promise<{
        error: string;
        success?: undefined;
        stdout?: undefined;
        stderr?: undefined;
        exitCode?: undefined;
        vcdPath?: undefined;
    } | {
        success: boolean;
        stdout: string;
        stderr: string;
        exitCode: number;
        vcdPath: string | undefined;
        error?: undefined;
    }>;
    get_project_stats: () => Promise<{
        files: number;
        modules: number;
        packages: number;
        interfaces: number;
        lastIndexed: number;
    }>;
    find_all_sv_files: (args: z.infer<typeof findAllSvFilesSchema>) => Promise<{
        directory: string;
        count: number;
        files: string[];
    }>;
};
export declare function getToolSpecs(): {
    read_file: {
        description: string;
        parameters: z.ZodObject<{
            path: z.ZodString;
            startLine: z.ZodOptional<z.ZodNumber>;
            endLine: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            path: string;
            startLine?: number | undefined;
            endLine?: number | undefined;
        }, {
            path: string;
            startLine?: number | undefined;
            endLine?: number | undefined;
        }>;
    };
    write_file: {
        description: string;
        parameters: z.ZodObject<{
            path: z.ZodString;
            content: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            path: string;
            content: string;
        }, {
            path: string;
            content: string;
        }>;
    };
    edit_lines: {
        description: string;
        parameters: z.ZodObject<{
            path: z.ZodString;
            edits: z.ZodArray<z.ZodObject<{
                startLine: z.ZodNumber;
                endLine: z.ZodNumber;
                newContent: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                startLine: number;
                endLine: number;
                newContent: string;
            }, {
                startLine: number;
                endLine: number;
                newContent: string;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            path: string;
            edits: {
                startLine: number;
                endLine: number;
                newContent: string;
            }[];
        }, {
            path: string;
            edits: {
                startLine: number;
                endLine: number;
                newContent: string;
            }[];
        }>;
    };
    search_replace: {
        description: string;
        parameters: z.ZodObject<{
            path: z.ZodString;
            search: z.ZodString;
            replace: z.ZodString;
            all: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
            isRegex: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        }, "strip", z.ZodTypeAny, {
            all: boolean;
            replace: string;
            search: string;
            path: string;
            isRegex: boolean;
        }, {
            replace: string;
            search: string;
            path: string;
            all?: boolean | undefined;
            isRegex?: boolean | undefined;
        }>;
    };
    list_files: {
        description: string;
        parameters: z.ZodObject<{
            directory: z.ZodString;
            extensions: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            recursive: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        }, "strip", z.ZodTypeAny, {
            directory: string;
            extensions: string[];
            recursive: boolean;
        }, {
            directory: string;
            extensions?: string[] | undefined;
            recursive?: boolean | undefined;
        }>;
    };
    search_code: {
        description: string;
        parameters: z.ZodObject<{
            pattern: z.ZodString;
            filePattern: z.ZodDefault<z.ZodOptional<z.ZodString>>;
            caseSensitive: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
            maxResults: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            caseSensitive: boolean;
            pattern: string;
            filePattern: string;
            maxResults: number;
        }, {
            pattern: string;
            caseSensitive?: boolean | undefined;
            filePattern?: string | undefined;
            maxResults?: number | undefined;
        }>;
    };
    find_module: {
        description: string;
        parameters: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
    };
    get_dependencies: {
        description: string;
        parameters: z.ZodObject<{
            module: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            module: string;
        }, {
            module: string;
        }>;
    };
    lint_file: {
        description: string;
        parameters: z.ZodObject<{
            path: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            path: string;
        }, {
            path: string;
        }>;
    };
    run_simulation: {
        description: string;
        parameters: z.ZodObject<{
            top: z.ZodString;
            testbench: z.ZodOptional<z.ZodString>;
            timeout: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            top: string;
            testbench?: string | undefined;
            timeout?: number | undefined;
        }, {
            top: string;
            testbench?: string | undefined;
            timeout?: number | undefined;
        }>;
    };
    get_project_stats: {
        description: string;
        parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    };
    find_all_sv_files: {
        description: string;
        parameters: z.ZodObject<{
            directory: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            directory: string;
        }, {
            directory?: string | undefined;
        }>;
    };
};
