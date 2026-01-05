/**
 * Simulate command - Run Verilator simulation on a testbench
 */
interface SimOptions {
    vcd?: boolean;
}
export declare function simCommand(file: string, options: SimOptions): Promise<void>;
export {};
