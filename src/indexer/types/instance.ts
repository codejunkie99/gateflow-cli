/**
 * Instance Types for SystemVerilog Indexer
 *
 * An INSTANCE is when you create a COPY of something (like a module).
 * It's different from references because it creates a new "thing" in
 * the design hierarchy, but it's based on a template (the module definition).
 *
 * Think of it like cookie cutters:
 * - Module declaration = the cookie cutter (template)
 * - Instance = a cookie made with that cutter (copy)
 *
 * Examples:
 * - `counter u_cnt (.clk(clk));`  -> Instance of module "counter"
 * - `axi_if axi_bus();`  -> Instance of interface "axi_if"
 * - `bind cpu checker u_chk();`  -> Bind instance
 *
 * @module types/instance
 */

import type { Location, Guard } from './location.js';

// ============================================================================
// InstanceKind - What type of thing is being instantiated
// ============================================================================

/**
 * The type of instance being created.
 *
 * SystemVerilog allows instantiating several types of constructs:
 * - **module**: Most common - creates a copy of a module
 * - **interface**: Creates an interface bundle
 * - **checker**: Creates a verification checker instance
 * - **bind**: Special - binds a module to another (verification)
 * - **generate**: Parameterized instantiation inside generate blocks
 */
export type InstanceKind =
  | 'module'
  | 'interface'
  | 'checker'
  | 'bind'
  | 'generate';

// ============================================================================
// Instance - A copy of a module/interface/checker
// ============================================================================

/**
 * An instance represents a COPY of a module/interface/checker.
 *
 * Instances form the design hierarchy - they're how modules
 * connect to create the full system.
 *
 * @example
 * ```typescript
 * // For: counter #(.WIDTH(16)) u_cnt (.clk(clk), .count(data));
 * const inst: Instance = {
 *   id: 'loc:abc123',
 *   instanceKind: 'module',
 *   instanceName: 'u_cnt',
 *   targetName: 'counter',
 *   location: { file: '/path/top.sv', line: 20, col: 3 },
 *   parentScope: ['top'],
 *   paramOverrides: { WIDTH: '16' },
 *   connections: [
 *     { portName: 'clk', signalName: 'clk', location: {...} },
 *     { portName: 'count', signalName: 'data', location: {...} }
 *   ]
 * };
 *
 * // For array instance: counter u_cnt[7:0] (...);
 * const arrayInst: Instance = {
 *   ...inst,
 *   arrayRange: '[7:0]'  // 8 instances
 * };
 *
 * // For bind: bind cpu cpu_checker u_chk (...);
 * const bindInst: Instance = {
 *   id: 'loc:def456',
 *   instanceKind: 'bind',
 *   instanceName: 'u_chk',
 *   targetName: 'cpu_checker',
 *   bindTarget: 'cpu',  // Module being bound to
 *   ...
 * };
 * ```
 */
export interface Instance {
  // -------------------------------------------------------------------------
  // ID - Location identifier
  // -------------------------------------------------------------------------

  /**
   * Location ID - Identifies WHERE this instance is.
   * Format: "loc:<16-char-hash>"
   *
   * Computed from: file + line + col
   */
  id: string;

  // -------------------------------------------------------------------------
  // What Kind
  // -------------------------------------------------------------------------

  /**
   * What type of thing is being instantiated.
   * Determines how to interpret other fields.
   */
  instanceKind: InstanceKind;

  // -------------------------------------------------------------------------
  // Names
  // -------------------------------------------------------------------------

  /**
   * Name of THIS instance (the copy).
   *
   * This is the local name by which we refer to this instance.
   * Example: In `counter u_cnt (...)`, instanceName is "u_cnt"
   */
  instanceName: string;

  /**
   * Name of what's being instantiated (the template).
   *
   * This is the module/interface/checker name.
   * Example: In `counter u_cnt (...)`, targetName is "counter"
   */
  targetName: string;

  // -------------------------------------------------------------------------
  // Array Instances
  // -------------------------------------------------------------------------

  /**
   * For array instances, the range expression.
   *
   * SystemVerilog allows creating multiple instances at once:
   * ```systemverilog
   * counter u_cnt[7:0] (...);  // Creates 8 instances
   * counter u_cnt[N-1:0] (...);  // Parameterized count
   * ```
   *
   * @example "[7:0]", "[N-1:0]", "[3:0][1:0]" (multi-dimensional)
   */
  arrayRange?: string;

  // -------------------------------------------------------------------------
  // Bind-Specific
  // -------------------------------------------------------------------------

  /**
   * For bind instances, the target module/instance being bound to.
   *
   * Bind statements inject verification code into design:
   * ```systemverilog
   * bind cpu cpu_checker u_chk (...);
   * //   ^^^ bindTarget  ^^^^^^^^^^^ the checker being bound
   * ```
   */
  bindTarget?: string;

  // -------------------------------------------------------------------------
  // Location
  // -------------------------------------------------------------------------

  /** File, line, and column where instance appears */
  location: Location;

  /**
   * Scope chain of the parent - what contains this instance.
   *
   * For normal instances, this is the module containing the instance.
   * For bind instances, this might be empty (file-level) or a module.
   *
   * @example ['top', 'cpu']  // Instance inside module 'cpu' inside module 'top'
   */
  parentScope: string[];

  // -------------------------------------------------------------------------
  // Resolution - Filled in later
  // -------------------------------------------------------------------------

  /**
   * Declaration ID of the target module/interface/checker.
   *
   * This is NOT filled in during initial parsing.
   * It's populated during the resolution phase when we
   * connect instances to their declarations.
   */
  resolvedId?: string;

  // -------------------------------------------------------------------------
  // Parameters
  // -------------------------------------------------------------------------

  /**
   * Parameter overrides specified in the instantiation.
   *
   * When instantiating, you can override default parameters:
   * ```systemverilog
   * counter #(.WIDTH(16), .DEPTH(32)) u_cnt (...);
   * ```
   *
   * This maps parameter names to their override values (as strings).
   *
   * @example { WIDTH: '16', DEPTH: '32' }
   */
  paramOverrides?: Record<string, string>;

  // -------------------------------------------------------------------------
  // Port Connections
  // -------------------------------------------------------------------------

  /**
   * List of port connections in the instantiation.
   *
   * These show how the instance's ports connect to signals.
   *
   * @example
   * For: `.clk(clock), .data(my_data)`
   * ```typescript
   * connections: [
   *   { portName: 'clk', signalName: 'clock', location: {...} },
   *   { portName: 'data', signalName: 'my_data', location: {...} }
   * ]
   * ```
   */
  connections?: PortConnection[];

  // -------------------------------------------------------------------------
  // Conditional Compilation
  // -------------------------------------------------------------------------

  /**
   * If this instance is inside an `ifdef/`ifndef block,
   * this records the condition.
   */
  guard?: Guard;

  // -------------------------------------------------------------------------
  // Generate-Specific
  // -------------------------------------------------------------------------

  /**
   * For instances inside generate blocks, the label name.
   *
   * Generate blocks can have labels:
   * ```systemverilog
   * generate
   *   for (genvar i = 0; i < N; i++) begin: gen_counters
   *     counter u_cnt (...);
   *   end
   * endgenerate
   * ```
   *
   * The label "gen_counters" is important for hierarchical references.
   */
  generateLabel?: string;
}

// ============================================================================
// PortConnection - How a port is connected
// ============================================================================

/**
 * Represents a single port connection in an instantiation.
 *
 * In SystemVerilog, ports are connected with named or positional syntax:
 * ```systemverilog
 * // Named connections (recommended)
 * counter u_cnt (.clk(clock), .data(my_data));
 *
 * // Positional connections (order matters)
 * counter u_cnt (clock, my_data);
 *
 * // Implicit connections (port name = signal name)
 * counter u_cnt (.clk, .data);  // Same as .clk(clk), .data(data)
 * ```
 *
 * @example
 * ```typescript
 * // For: .clk(clock)
 * const conn: PortConnection = {
 *   portName: 'clk',
 *   signalName: 'clock',
 *   location: { file: '/path/top.sv', line: 20, col: 25 }
 * };
 *
 * // For implicit: .clk (same as .clk(clk))
 * const implicitConn: PortConnection = {
 *   portName: 'clk',
 *   signalName: 'clk',  // Same as port name
 *   location: {...}
 * };
 * ```
 */
export interface PortConnection {
  /**
   * Name of the port on the instantiated module.
   * Example: In `.clk(clock)`, portName is "clk"
   */
  portName: string;

  /**
   * Name of the signal connected to the port.
   * Example: In `.clk(clock)`, signalName is "clock"
   *
   * Can be:
   * - A simple signal name: "clock"
   * - An expression: "data[7:0]"
   * - A constant: "1'b0"
   */
  signalName: string;

  /**
   * Location of this specific connection.
   * Points to where the connection is written in the instantiation.
   */
  location: Location;
}
