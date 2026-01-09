/**
 * SV Indexer Extended Tests
 *
 * Additional tests for the SystemVerilog indexer covering:
 * - Scanner unit tests with inline content
 * - Preprocessor edge cases
 * - Class hierarchy and OOP features
 * - SVA (sequences, properties, assertions)
 * - DPI import/export
 * - Checker and bind constructs
 * - Complex scenarios
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

// Import modules under test
import { stripComments, handleLineContinuation, preprocess } from '../indexer/preprocessor/index.js';
import { buildLineIndex, getLineNumber, getLocation } from '../indexer/reader/index.js';
import { scanDeclarations } from '../indexer/scanners/declaration-scanner.js';
import { scanReferences, isBuiltinType, isKeyword } from '../indexer/scanners/reference-scanner.js';
import { scanInstances } from '../indexer/scanners/instance-scanner.js';
import { scanDirectives } from '../indexer/scanners/directive-scanner.js';
import { ScopeTracker } from '../indexer/scanners/index.js';
import { FileUnderstander } from '../indexer/understander/index.js';
import { DeclarationIndex } from '../indexer/resolver/index.js';
import { DependencyGraph, findTopModules, formatHierarchy } from '../indexer/analyzer/index.js';
import { SVIndexer } from '../indexer/sv-indexer.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixture paths
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'sv');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse inline SV content for testing scanners directly.
 */
function parseContent(content: string, filePath = 'test.sv') {
  const { cleaned } = preprocess(content);
  const lineOffsets = buildLineIndex(content);
  return { cleaned, lineOffsets, filePath };
}

// ============================================================================
// Preprocessor Edge Cases
// ============================================================================

describe('Preprocessor Edge Cases', () => {
  describe('stripComments - complex cases', () => {
    it('should handle nested block comment markers in strings', () => {
      const input = 'string s = "/* not a comment */";';
      const { cleaned } = stripComments(input);
      expect(cleaned).toContain('"/* not a comment */"');
    });

    it('should handle escaped quotes in strings', () => {
      const input = 'string s = "he said \\"hello\\""; // comment';
      const { cleaned } = stripComments(input);
      expect(cleaned).toContain('"he said \\"hello\\""');
      expect(cleaned).not.toContain('comment');
    });

    it('should handle single-quoted strings', () => {
      const input = "bit b = '1; // comment";
      const { cleaned } = stripComments(input);
      expect(cleaned).toContain("'1");
      expect(cleaned).not.toContain('comment');
    });

    it('should handle multiple block comments on same line', () => {
      const input = 'a /* c1 */ + b /* c2 */ = c;';
      const { cleaned } = stripComments(input);
      expect(cleaned).toContain('a');
      expect(cleaned).toContain('+ b');
      expect(cleaned).toContain('= c;');
      expect(cleaned).not.toContain('c1');
      expect(cleaned).not.toContain('c2');
    });

    it('should handle comment at end of file without newline', () => {
      const input = 'endmodule // final comment';
      const { cleaned } = stripComments(input);
      expect(cleaned).toContain('endmodule');
      expect(cleaned).not.toContain('final comment');
    });

    it('should handle empty block comments', () => {
      const input = 'a /**/ b';
      const { cleaned } = stripComments(input);
      expect(cleaned).toContain('a');
      expect(cleaned).toContain('b');
    });

    it('should handle unclosed block comment gracefully', () => {
      const input = 'a /* unclosed';
      const { cleaned } = stripComments(input);
      expect(cleaned).toContain('a');
    });

    it('should preserve attribute syntax (* *)', () => {
      const input = '(* full_case *) case (state)';
      const { cleaned } = stripComments(input);
      expect(cleaned).toContain('(* full_case *)');
    });
  });

  describe('handleLineContinuation - complex cases', () => {
    it('should handle backslash at end of file', () => {
      const input = '`define TEST \\';
      const { processed } = handleLineContinuation(input);
      expect(processed).toBeDefined();
    });

    it('should handle multiple consecutive continuations', () => {
      const input = '`define MULTI line1 \\\nline2 \\\nline3 \\\nline4';
      const { processed } = handleLineContinuation(input);
      expect(processed.replace(/\s+/g, ' ')).toContain('line1 line2 line3 line4');
    });

    it('should handle Windows line endings with continuation', () => {
      const input = '`define WINLINE value \\\r\ncontinued';
      const { processed } = handleLineContinuation(input);
      expect(processed).toContain('value');
      expect(processed).toContain('continued');
    });
  });
});

// ============================================================================
// Declaration Scanner Unit Tests
// ============================================================================

describe('Declaration Scanner - Inline Content', () => {
  describe('Module declarations', () => {
    it('should parse simple module', () => {
      const content = 'module simple_mod; endmodule';
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const modules = declarations.filter(d => d.kind === 'module');
      expect(modules.length).toBe(1);
      expect(modules[0].name).toBe('simple_mod');
    });

    it('should parse module with parameters', () => {
      const content = `
        module param_mod #(
          parameter WIDTH = 8,
          parameter DEPTH = 16
        )(
          input logic clk,
          output logic [WIDTH-1:0] data
        );
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const modules = declarations.filter(d => d.kind === 'module');
      expect(modules.length).toBe(1);
      expect(modules[0].name).toBe('param_mod');

      const params = declarations.filter(d => d.kind === 'parameter');
      expect(params.length).toBe(2);
      expect(params.map(p => p.name)).toContain('WIDTH');
      expect(params.map(p => p.name)).toContain('DEPTH');
    });

    it('should parse multiple modules in same file', () => {
      const content = `
        module mod_a; endmodule
        module mod_b; endmodule
        module mod_c; endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const modules = declarations.filter(d => d.kind === 'module');
      expect(modules.length).toBe(3);
      expect(modules.map(m => m.name)).toEqual(['mod_a', 'mod_b', 'mod_c']);
    });
  });

  describe('Package declarations', () => {
    it('should parse package with contents', () => {
      const content = `
        package my_pkg;
          typedef logic [7:0] byte_t;
          parameter int SIZE = 100;
        endpackage
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const packages = declarations.filter(d => d.kind === 'package');
      expect(packages.length).toBe(1);
      expect(packages[0].name).toBe('my_pkg');
    });
  });

  describe('Interface declarations', () => {
    it('should parse interface with modports', () => {
      const content = `
        interface axi_if;
          logic valid;
          logic ready;
          logic [31:0] data;

          modport master(output valid, output data, input ready);
          modport slave(input valid, input data, output ready);
        endinterface
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const interfaces = declarations.filter(d => d.kind === 'interface');
      expect(interfaces.length).toBe(1);
      expect(interfaces[0].name).toBe('axi_if');

      const modports = declarations.filter(d => d.kind === 'modport');
      expect(modports.length).toBe(2);
      expect(modports.map(m => m.name)).toContain('master');
      expect(modports.map(m => m.name)).toContain('slave');
    });
  });

  describe('Class declarations', () => {
    it('should parse simple class', () => {
      const content = `
        class transaction;
          rand bit [7:0] data;
        endclass
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const classes = declarations.filter(d => d.kind === 'class');
      expect(classes.length).toBe(1);
      expect(classes[0].name).toBe('transaction');
    });

    it('should parse virtual class', () => {
      const content = `
        virtual class base_class;
          pure virtual function void display();
        endclass
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const classes = declarations.filter(d => d.kind === 'class');
      expect(classes.length).toBe(1);
      expect(classes[0].name).toBe('base_class');
      expect(classes[0].data.isVirtual).toBe(true);
    });

    it('should parse class with extends', () => {
      const content = `
        class derived_class extends base_class;
          int extra_field;
        endclass
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const classes = declarations.filter(d => d.kind === 'class');
      expect(classes.length).toBe(1);
      expect(classes[0].name).toBe('derived_class');
      expect(classes[0].data.extendsName).toBe('base_class');
    });

    it('should parse class with scoped extends', () => {
      const content = `
        class my_class extends pkg::parent_class;
        endclass
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const classes = declarations.filter(d => d.kind === 'class');
      expect(classes.length).toBe(1);
      expect(classes[0].data.extendsName).toBe('pkg::parent_class');
    });
  });

  describe('Function and Task declarations', () => {
    it('should parse function with return type', () => {
      const content = `
        module test;
          function int calculate(int a, int b);
            return a + b;
          endfunction
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const functions = declarations.filter(d => d.kind === 'function');
      expect(functions.length).toBe(1);
      expect(functions[0].name).toBe('calculate');
      expect(functions[0].data.returnType).toBe('int');
    });

    it('should parse automatic function', () => {
      const content = `
        function automatic void auto_func();
        endfunction
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const functions = declarations.filter(d => d.kind === 'function');
      expect(functions.length).toBe(1);
      expect(functions[0].name).toBe('auto_func');
    });

    it('should parse task', () => {
      const content = `
        task automatic my_task(input int value);
          #10;
        endtask
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const tasks = declarations.filter(d => d.kind === 'task');
      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe('my_task');
    });
  });

  describe('Type declarations', () => {
    it('should parse typedef', () => {
      const content = `
        typedef logic [15:0] halfword_t;
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const typedefs = declarations.filter(d => d.kind === 'typedef');
      expect(typedefs.length).toBe(1);
      expect(typedefs[0].name).toBe('halfword_t');
    });

    it('should parse enum', () => {
      const content = `
        typedef enum logic [1:0] {
          IDLE = 2'b00,
          RUN  = 2'b01,
          DONE = 2'b10
        } state_t;
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const enums = declarations.filter(d => d.kind === 'enum');
      expect(enums.length).toBe(1);
      expect(enums[0].name).toBe('state_t');

      const enumValues = declarations.filter(d => d.kind === 'enum_value');
      expect(enumValues.length).toBe(3);
      expect(enumValues.map(e => e.name)).toContain('IDLE');
      expect(enumValues.map(e => e.name)).toContain('RUN');
      expect(enumValues.map(e => e.name)).toContain('DONE');
    });

    it('should parse struct', () => {
      const content = `
        typedef struct packed {
          logic valid;
          logic [7:0] data;
        } packet_t;
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const structs = declarations.filter(d => d.kind === 'struct');
      expect(structs.length).toBe(1);
      expect(structs[0].name).toBe('packet_t');
    });
  });

  describe('Signal declarations', () => {
    it('should parse wire declaration', () => {
      const content = `
        module test;
          wire [7:0] data_bus;
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const signals = declarations.filter(d => d.kind === 'signal');
      expect(signals.some(s => s.name === 'data_bus')).toBe(true);
    });

    it('should parse logic declaration', () => {
      const content = `
        module test;
          logic [31:0] counter;
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const signals = declarations.filter(d => d.kind === 'signal');
      expect(signals.some(s => s.name === 'counter')).toBe(true);
    });
  });

  describe('Always blocks', () => {
    it('should parse always_ff block', () => {
      const content = `
        module test;
          always_ff @(posedge clk or negedge rst_n) begin
            if (!rst_n) q <= 0;
            else q <= d;
          end
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const alwaysBlocks = declarations.filter(d => d.kind === 'always_block');
      expect(alwaysBlocks.length).toBe(1);
      expect(alwaysBlocks[0].data.blockType).toBe('always_ff');
    });

    it('should parse always_comb block', () => {
      const content = `
        module test;
          always_comb begin
            y = a & b;
          end
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const alwaysBlocks = declarations.filter(d => d.kind === 'always_block');
      expect(alwaysBlocks.length).toBe(1);
      expect(alwaysBlocks[0].data.blockType).toBe('always_comb');
    });
  });

  describe('SVA declarations', () => {
    it('should parse sequence declaration', () => {
      const content = `
        sequence req_ack;
          req ##[1:5] ack;
        endsequence
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const sequences = declarations.filter(d => d.kind === 'sequence');
      expect(sequences.length).toBe(1);
      expect(sequences[0].name).toBe('req_ack');
    });

    it('should parse property declaration', () => {
      const content = `
        property req_eventually_ack;
          @(posedge clk) req |-> ##[1:10] ack;
        endproperty
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const properties = declarations.filter(d => d.kind === 'property');
      expect(properties.length).toBe(1);
      expect(properties[0].name).toBe('req_eventually_ack');
    });

    it('should parse covergroup declaration', () => {
      const content = `
        covergroup addr_cg @(posedge clk);
          addr_cp: coverpoint addr;
        endgroup
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const covergroups = declarations.filter(d => d.kind === 'covergroup');
      expect(covergroups.length).toBe(1);
      expect(covergroups[0].name).toBe('addr_cg');
    });
  });

  describe('Constraint declarations', () => {
    it('should parse constraint', () => {
      const content = `
        class transaction;
          rand bit [7:0] addr;
          constraint addr_range {
            addr inside {[0:255]};
          }
        endclass
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const constraints = declarations.filter(d => d.kind === 'constraint');
      expect(constraints.length).toBe(1);
      expect(constraints[0].name).toBe('addr_range');
    });
  });

  describe('Checker declarations', () => {
    it('should parse checker', () => {
      const content = `
        checker protocol_check(logic clk, logic valid);
          default clocking @(posedge clk);
          endclocking
        endchecker
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const checkers = declarations.filter(d => d.kind === 'checker');
      expect(checkers.length).toBe(1);
      expect(checkers[0].name).toBe('protocol_check');
    });
  });

  describe('Clocking blocks', () => {
    it('should parse clocking block', () => {
      const content = `
        clocking cb @(posedge clk);
          input valid;
          output ready;
        endclocking
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

      const clockings = declarations.filter(d => d.kind === 'clocking');
      expect(clockings.length).toBe(1);
      expect(clockings[0].name).toBe('cb');
    });
  });
});

// ============================================================================
// Reference Scanner Unit Tests
// ============================================================================

describe('Reference Scanner - Inline Content', () => {
  describe('Import statements', () => {
    it('should parse wildcard import', () => {
      const content = `
        module test;
          import my_pkg::*;
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const imports = references.filter(r => r.kind === 'import');
      expect(imports.length).toBe(1);
      expect(imports[0].targetName).toBe('my_pkg');
      expect(imports[0].data?.memberName).toBe('*');
    });

    it('should parse specific import', () => {
      const content = `
        module test;
          import my_pkg::my_type;
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const imports = references.filter(r => r.kind === 'import');
      expect(imports.length).toBe(1);
      expect(imports[0].targetName).toBe('my_pkg');
      expect(imports[0].data?.memberName).toBe('my_type');
    });

    it('should parse multiple imports', () => {
      const content = `
        module test;
          import pkg_a::*;
          import pkg_b::type_b;
          import pkg_c::func_c;
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const imports = references.filter(r => r.kind === 'import');
      expect(imports.length).toBe(3);
    });
  });

  describe('Extends references', () => {
    it('should parse extends', () => {
      const content = `
        class child extends parent;
        endclass
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const extendsRefs = references.filter(r => r.kind === 'extends');
      expect(extendsRefs.length).toBe(1);
      expect(extendsRefs[0].targetName).toBe('parent');
    });

    it('should parse scoped extends', () => {
      const content = `
        class my_class extends uvm_pkg::uvm_component;
        endclass
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const extendsRefs = references.filter(r => r.kind === 'extends');
      expect(extendsRefs.length).toBe(1);
      expect(extendsRefs[0].targetName).toBe('uvm_pkg::uvm_component');
    });
  });

  describe('Macro usages', () => {
    it('should parse macro usage', () => {
      const content = 'module test;\n  wire [\`WIDTH-1:0] data;\nendmodule';
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const macroUsages = references.filter(r => r.kind === 'macro_usage');
      expect(macroUsages.some(m => m.targetName === 'WIDTH')).toBe(true);
    });

    it('should not parse directive keywords as macro usage', () => {
      const content = '\`define TEST 1\n\`ifdef TEST\n\`endif';
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const macroUsages = references.filter(r => r.kind === 'macro_usage');
      // Should not include 'define', 'ifdef', 'endif' as macro usages
      expect(macroUsages.every(m => !['define', 'ifdef', 'endif'].includes(m.targetName))).toBe(true);
    });
  });

  describe('Assertion references', () => {
    it('should parse assert property reference', () => {
      const content = `
        module test;
          assert property (my_property)
            else $error("Failed");
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const assertRefs = references.filter(r => r.kind === 'assert_usage');
      expect(assertRefs.length).toBe(1);
      expect(assertRefs[0].targetName).toBe('my_property');
    });

    it('should parse assume property reference', () => {
      const content = `
        module test;
          assume property (input_valid_p);
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const assumeRefs = references.filter(r => r.kind === 'assume_usage');
      expect(assumeRefs.length).toBe(1);
      expect(assumeRefs[0].targetName).toBe('input_valid_p');
    });

    it('should parse cover property reference', () => {
      const content = `
        module test;
          cover property (handshake_complete);
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const coverRefs = references.filter(r => r.kind === 'cover_usage');
      expect(coverRefs.length).toBe(1);
      expect(coverRefs[0].targetName).toBe('handshake_complete');
    });
  });

  describe('Scoped identifier references', () => {
    it('should parse package scoped type', () => {
      const content = `
        module test;
          my_pkg::my_type_t data;
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations);

      const typeUsages = references.filter(r => r.kind === 'type_usage');
      expect(typeUsages.some(t => t.targetName === 'my_pkg::my_type_t')).toBe(true);
    });
  });

  describe('Helper functions', () => {
    it('isBuiltinType should identify built-in types', () => {
      expect(isBuiltinType('logic')).toBe(true);
      expect(isBuiltinType('wire')).toBe(true);
      expect(isBuiltinType('int')).toBe(true);
      expect(isBuiltinType('string')).toBe(true);
      expect(isBuiltinType('my_custom_type')).toBe(false);
    });

    it('isKeyword should identify keywords', () => {
      expect(isKeyword('module')).toBe(true);
      expect(isKeyword('function')).toBe(true);
      expect(isKeyword('always')).toBe(true);
      expect(isKeyword('my_identifier')).toBe(false);
    });
  });
});

// ============================================================================
// Instance Scanner Unit Tests
// ============================================================================

describe('Instance Scanner - Inline Content', () => {
  describe('Module instantiation', () => {
    it('should parse simple module instance', () => {
      const content = `
        module top;
          counter u_counter (
            .clk(clk),
            .rst_n(rst_n),
            .count(count)
          );
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      expect(instances.length).toBe(1);
      expect(instances[0].targetName).toBe('counter');
      expect(instances[0].instanceName).toBe('u_counter');
    });

    it('should parse instance with parameters', () => {
      const content = `
        module top;
          counter #(8) u_counter (.clk(clk), .count(count));
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      expect(instances.length).toBe(1);
      expect(instances[0].targetName).toBe('counter');
      expect(instances[0].instanceName).toBe('u_counter');
    });

    it('should parse instance with nested parentheses in parameters', () => {
      // This tests the fix for nested parentheses like #(.WIDTH(8), .DEPTH(16))
      const content = `
        module top;
          fifo #(.WIDTH(8), .DEPTH(16)) u_fifo (.clk(clk), .data(data));
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      expect(instances.length).toBe(1);
      expect(instances[0].targetName).toBe('fifo');
      expect(instances[0].instanceName).toBe('u_fifo');
      expect(instances[0].paramOverrides).toBeDefined();
      expect(instances[0].paramOverrides?.WIDTH).toBe('8');
      expect(instances[0].paramOverrides?.DEPTH).toBe('16');
    });

    it('should parse multiple instances', () => {
      const content = `
        module top;
          counter u_cnt1 (.clk(clk), .count(cnt1));
          counter u_cnt2 (.clk(clk), .count(cnt2));
          adder u_add (.a(a), .b(b), .sum(sum));
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      expect(instances.length).toBe(3);
      expect(instances.map(i => i.instanceName)).toContain('u_cnt1');
      expect(instances.map(i => i.instanceName)).toContain('u_cnt2');
      expect(instances.map(i => i.instanceName)).toContain('u_add');
    });

    it('should parse instance with implicit port connections', () => {
      const content = `
        module top;
          counter u_counter (
            .clk,
            .rst_n,
            .count
          );
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      expect(instances.length).toBe(1);
      expect(instances[0].connections).toBeDefined();
    });
  });

  describe('Array instances', () => {
    it('should parse array instance', () => {
      const content = `
        module top;
          counter u_counters [3:0] (
            .clk(clk),
            .count(counts)
          );
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      expect(instances.length).toBe(1);
      expect(instances[0].instanceName).toBe('u_counters');
      expect(instances[0].arrayRange).toBe('[3:0]');
    });
  });

  describe('Bind statements', () => {
    it('should parse bind statement', () => {
      const content = `
        bind target_module checker_module u_checker (
          .clk(clk),
          .valid(valid)
        );
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      const bindInst = instances.find(i => i.instanceKind === 'bind');
      expect(bindInst).toBeDefined();
      expect(bindInst?.targetName).toBe('checker_module');
      expect(bindInst?.bindTarget).toBe('target_module');
      expect(bindInst?.instanceName).toBe('u_checker');
    });
  });

  describe('Filtering false positives', () => {
    it('should not treat function calls as instances', () => {
      const content = `
        module test;
          function int calculate(int a);
            return a * 2;
          endfunction

          initial begin
            int x = calculate(5);
          end
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      // Should not include 'calculate' as an instance
      expect(instances.every(i => i.targetName !== 'calculate')).toBe(true);
    });

    it('should not treat control flow as instances', () => {
      const content = `
        module test;
          always @(*) begin
            if (cond) begin
              a = 1;
            end
            for (int i = 0; i < 10; i++) begin
              b = i;
            end
          end
        endmodule
      `;
      const { cleaned, lineOffsets, filePath } = parseContent(content);
      const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);
      const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations);

      // Should not include 'if' or 'for' as instances
      expect(instances.every(i => !['if', 'for', 'while'].includes(i.targetName))).toBe(true);
    });
  });
});

// ============================================================================
// Directive Scanner Tests
// ============================================================================

describe('Directive Scanner', () => {
  it('should parse define directives', () => {
    const content = '\`define WIDTH 8\n\`define MACRO(a, b) ((a) + (b))';
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const scopeTracker = new ScopeTracker();
    const { directives } = scanDirectives(cleaned, filePath, lineOffsets, scopeTracker);

    const defines = directives.filter(d => d.kind === 'define');
    expect(defines.length).toBe(2);
    expect(defines.some(d => d.data.name === 'WIDTH')).toBe(true);
    expect(defines.some(d => d.data.name === 'MACRO')).toBe(true);
  });

  it('should parse include directives', () => {
    const content = '\`include "header.svh"\n\`include <std_header.svh>';
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const scopeTracker = new ScopeTracker();
    const { directives } = scanDirectives(cleaned, filePath, lineOffsets, scopeTracker);

    const includes = directives.filter(d => d.kind === 'include');
    expect(includes.length).toBe(2);
  });

  it('should parse ifdef/ifndef/else/endif', () => {
    const content = '\`ifdef DEBUG\n// debug code\n\`elsif VERBOSE\n// verbose\n\`else\n// normal\n\`endif';
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const scopeTracker = new ScopeTracker();
    const { directives } = scanDirectives(cleaned, filePath, lineOffsets, scopeTracker);

    expect(directives.some(d => d.kind === 'ifdef')).toBe(true);
    expect(directives.some(d => d.kind === 'elsif')).toBe(true);
    expect(directives.some(d => d.kind === 'else')).toBe(true);
    expect(directives.some(d => d.kind === 'endif')).toBe(true);
  });

  it('should parse timescale directive', () => {
    const content = '\`timescale 1ns/1ps';
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const scopeTracker = new ScopeTracker();
    const { directives } = scanDirectives(cleaned, filePath, lineOffsets, scopeTracker);

    const timescales = directives.filter(d => d.kind === 'timescale');
    expect(timescales.length).toBe(1);
  });
});

// ============================================================================
// Scope Tracker Extended Tests
// ============================================================================

describe('ScopeTracker Extended', () => {
  it('should handle deeply nested scopes', () => {
    const tracker = new ScopeTracker();

    tracker.enter('package', 'pkg', 1);
    tracker.enter('class', 'cls', 10);
    tracker.enter('function', 'func', 20);
    tracker.enter('task', 'task', 30);

    expect(tracker.getScope()).toEqual(['pkg', 'cls', 'func', 'task']);
    expect(tracker.getScope().length).toBe(4);

    tracker.exit();
    expect(tracker.getScope()).toEqual(['pkg', 'cls', 'func']);

    tracker.exit();
    tracker.exit();
    tracker.exit();
    expect(tracker.getScope()).toEqual([]);
  });

  it('should handle nested guards', () => {
    const tracker = new ScopeTracker();

    tracker.pushGuard('DEBUG', false, 1);
    tracker.pushGuard('VERBOSE', false, 2);
    tracker.pushGuard('TRACE', true, 3); // ifndef

    const guard = tracker.getGuard();
    expect(guard).toBeDefined();

    tracker.popGuard();
    tracker.popGuard();
    tracker.popGuard();

    expect(tracker.getGuard()).toBeUndefined();
  });

  it('should track scope with parent IDs', () => {
    const tracker = new ScopeTracker();

    tracker.enter('module', 'mod', 1, 'decl:mod1');
    expect(tracker.getParentId()).toBe('decl:mod1');

    tracker.enter('function', 'fn', 10, 'decl:fn1');
    expect(tracker.getParentId()).toBe('decl:fn1');

    tracker.exit();
    expect(tracker.getParentId()).toBe('decl:mod1');
  });
});

// ============================================================================
// Declaration Index Extended Tests
// ============================================================================

describe('DeclarationIndex Extended', () => {
  it('should find by name in scope', () => {
    const index = new DeclarationIndex();

    index.add({
      id: 'decl:1',
      locationId: 'loc:1',
      kind: 'function',
      name: 'calc',
      location: { file: 'a.sv', line: 1, col: 1 },
      scope: ['my_pkg'],
      data: { kind: 'function', returnType: 'int', args: [] },
    });

    index.add({
      id: 'decl:2',
      locationId: 'loc:2',
      kind: 'function',
      name: 'calc',
      location: { file: 'b.sv', line: 1, col: 1 },
      scope: ['other_pkg'],
      data: { kind: 'function', returnType: 'void', args: [] },
    });

    const result = index.getByNameInScope('calc', ['my_pkg']);
    expect(result).toBeDefined();
    expect(result?.scope).toContain('my_pkg');
  });

  it('should return all declarations', () => {
    const index = new DeclarationIndex();

    index.add({
      id: 'decl:1',
      locationId: 'loc:1',
      kind: 'module',
      name: 'mod1',
      location: { file: 'a.sv', line: 1, col: 1 },
      scope: [],
      data: { kind: 'module', params: [] },
    });

    index.add({
      id: 'decl:2',
      locationId: 'loc:2',
      kind: 'package',
      name: 'pkg1',
      location: { file: 'b.sv', line: 1, col: 1 },
      scope: [],
      data: { kind: 'package' },
    });

    const all = index.all();
    expect(all.length).toBe(2);
  });
});

// ============================================================================
// Dependency Graph Extended Tests
// ============================================================================

describe('DependencyGraph Extended', () => {
  it('should handle diamond dependencies', () => {
    const graph = new DependencyGraph();

    // Diamond: A -> B, A -> C, B -> D, C -> D
    graph.addEdge({ fromFile: 'a.sv', toFile: 'b.sv', reason: 'instantiates', entityName: 'b' });
    graph.addEdge({ fromFile: 'a.sv', toFile: 'c.sv', reason: 'instantiates', entityName: 'c' });
    graph.addEdge({ fromFile: 'b.sv', toFile: 'd.sv', reason: 'instantiates', entityName: 'd' });
    graph.addEdge({ fromFile: 'c.sv', toFile: 'd.sv', reason: 'instantiates', entityName: 'd' });

    expect(graph.hasCycles()).toBe(false);

    const order = graph.getCompileOrder();
    const dIdx = order.indexOf('d.sv');
    const bIdx = order.indexOf('b.sv');
    const cIdx = order.indexOf('c.sv');
    const aIdx = order.indexOf('a.sv');

    expect(dIdx).toBeLessThan(bIdx);
    expect(dIdx).toBeLessThan(cIdx);
    expect(bIdx).toBeLessThan(aIdx);
    expect(cIdx).toBeLessThan(aIdx);
  });

  it('should calculate affected files correctly', () => {
    const graph = new DependencyGraph();

    graph.addEdge({ fromFile: 'top.sv', toFile: 'mid.sv', reason: 'instantiates', entityName: 'mid' });
    graph.addEdge({ fromFile: 'mid.sv', toFile: 'leaf.sv', reason: 'instantiates', entityName: 'leaf' });

    const affected = graph.getAllDependents('leaf.sv');
    expect(affected.has('mid.sv')).toBe(true);
    expect(affected.has('top.sv')).toBe(true);
  });

  it('should add edges in bulk', () => {
    const graph = new DependencyGraph();

    graph.addEdges([
      { fromFile: 'a.sv', toFile: 'b.sv', reason: 'instantiates', entityName: 'b' },
      { fromFile: 'b.sv', toFile: 'c.sv', reason: 'imports', entityName: 'pkg' },
      { fromFile: 'a.sv', toFile: 'c.sv', reason: 'includes', entityName: 'header' },
    ]);

    expect(graph.getDependencies('a.sv').size).toBe(2);
    expect(graph.getDependents('c.sv').size).toBe(2);
  });
});

// ============================================================================
// File Understander with New Fixtures
// ============================================================================

describe('FileUnderstander - Advanced Fixtures', () => {
  let understander: FileUnderstander;

  beforeAll(() => {
    understander = new FileUnderstander();
  });

  it('should parse class hierarchy file', async () => {
    const filePath = path.join(FIXTURES_DIR, 'class_hierarchy.sv');
    const result = await understander.understand(filePath);

    // Should find virtual class
    const virtualClass = result.declarations.find(
      d => d.kind === 'class' && d.name === 'base_transaction'
    );
    expect(virtualClass).toBeDefined();
    expect(virtualClass?.data.isVirtual).toBe(true);

    // Should find derived classes
    const readTx = result.declarations.find(
      d => d.kind === 'class' && d.name === 'read_transaction'
    );
    expect(readTx).toBeDefined();
    expect(readTx?.data.extendsName).toBe('base_transaction');

    // Should find constraints
    const constraints = result.declarations.filter(d => d.kind === 'constraint');
    expect(constraints.length).toBeGreaterThan(0);

    // Should find covergroups
    const covergroups = result.declarations.filter(d => d.kind === 'covergroup');
    expect(covergroups.length).toBeGreaterThan(0);

    // Should find functions
    const functions = result.declarations.filter(d => d.kind === 'function');
    expect(functions.length).toBeGreaterThan(0);
  });

  it('should parse assertions file', async () => {
    const filePath = path.join(FIXTURES_DIR, 'assertions.sv');
    const result = await understander.understand(filePath);

    // Should find sequences
    const sequences = result.declarations.filter(d => d.kind === 'sequence');
    expect(sequences.length).toBeGreaterThan(0);

    // Should find properties
    const properties = result.declarations.filter(d => d.kind === 'property');
    expect(properties.length).toBeGreaterThan(0);

    // Should find clocking blocks
    const clockings = result.declarations.filter(d => d.kind === 'clocking');
    expect(clockings.length).toBeGreaterThan(0);

    // Should find module
    const module = result.declarations.find(d => d.kind === 'module');
    expect(module).toBeDefined();
    expect(module?.name).toBe('assertions_example');
  });

  it('should parse DPI example file', async () => {
    const filePath = path.join(FIXTURES_DIR, 'dpi_example.sv');
    const result = await understander.understand(filePath);

    // Should find the module
    const module = result.declarations.find(d => d.kind === 'module');
    expect(module).toBeDefined();
    expect(module?.name).toBe('dpi_example');

    // Should find functions
    const functions = result.declarations.filter(d => d.kind === 'function');
    expect(functions.length).toBeGreaterThan(0);
  });

  it('should parse checker example file', async () => {
    const filePath = path.join(FIXTURES_DIR, 'checker_example.sv');
    const result = await understander.understand(filePath);

    // Should find checker
    const checker = result.declarations.find(d => d.kind === 'checker');
    expect(checker).toBeDefined();
    expect(checker?.name).toBe('protocol_checker');

    // Should find modules
    const modules = result.declarations.filter(d => d.kind === 'module');
    expect(modules.length).toBeGreaterThanOrEqual(2);

    // Should find bind instance
    const bindInstances = result.instances.filter(i => i.instanceKind === 'bind');
    expect(bindInstances.length).toBe(1);
  });
});

// ============================================================================
// SVIndexer Extended Integration Tests
// ============================================================================

describe('SVIndexer Extended Integration', () => {
  it('should index files directly without filelist', async () => {
    const indexer = new SVIndexer();

    const files = [
      path.join(FIXTURES_DIR, 'counter.sv'),
      path.join(FIXTURES_DIR, 'types_pkg.sv'),
    ];

    const project = await indexer.indexFiles(files);

    expect(project.files.length).toBe(2);
    expect(project.declarations.length).toBeGreaterThan(0);
  });

  it('should parse a single file', async () => {
    const indexer = new SVIndexer();
    const filePath = path.join(FIXTURES_DIR, 'counter.sv');

    const result = await indexer.parseFile(filePath);

    expect(result.declarations.length).toBeGreaterThan(0);
    expect(result.file.path).toBe(filePath);
  });

  it('should parse multiple files', async () => {
    const indexer = new SVIndexer();

    const files = [
      path.join(FIXTURES_DIR, 'counter.sv'),
      path.join(FIXTURES_DIR, 'types_pkg.sv'),
      path.join(FIXTURES_DIR, 'top.sv'),
    ];

    const results = await indexer.parseFiles(files);

    expect(results.length).toBe(3);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('should handle non-existent file gracefully', async () => {
    const indexer = new SVIndexer();
    const filePath = path.join(FIXTURES_DIR, 'non_existent.sv');

    const results = await indexer.parseFiles([filePath]);

    expect(results.length).toBe(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  it('should handle empty file', () => {
    const content = '';
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

    expect(declarations.length).toBe(0);
  });

  it('should handle file with only comments', () => {
    const content = `
      // This is a comment
      /* This is also a comment */
    `;
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

    // After comment stripping, there should be no declarations
    expect(declarations.length).toBe(0);
  });

  it('should handle incomplete module definition', () => {
    const content = `
      module incomplete
      // Missing endmodule
    `;
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

    // Should still find the module (parser is lenient)
    const modules = declarations.filter(d => d.kind === 'module');
    expect(modules.length).toBe(1);
    expect(modules[0].name).toBe('incomplete');
  });

  it('should handle special characters in identifiers', () => {
    const content = `
      module mod_with_underscore;
        logic signal_with_numbers_123;
      endmodule
    `;
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

    const modules = declarations.filter(d => d.kind === 'module');
    expect(modules.length).toBe(1);
    expect(modules[0].name).toBe('mod_with_underscore');
  });

  it('should handle very long lines', () => {
    const longParam = 'parameter LONG_PARAM = ' + 'a'.repeat(1000);
    const content = `
      module test;
        ${longParam};
      endmodule
    `;
    const { cleaned, lineOffsets, filePath } = parseContent(content);
    const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

    const modules = declarations.filter(d => d.kind === 'module');
    expect(modules.length).toBe(1);
  });
});
