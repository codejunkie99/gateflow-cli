/**
 * Generate command - Generate SystemVerilog code from natural language
 */
interface GenerateOptions {
    output?: string;
    tb?: boolean;
}
export declare function generateCommand(spec: string, options: GenerateOptions): Promise<void>;
export {};
