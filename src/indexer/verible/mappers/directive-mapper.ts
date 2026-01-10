/**
 * Directive Mapper
 *
 * Handles preprocessor directive mapping:
 * - include, define, undef
 * - ifdef, ifndef, elsif, else, endif
 * - timescale, default_nettype, pragma
 * - DPI import/export
 *
 * @module verible/mappers/directive-mapper
 */

import type { VeribleNode } from '../types.js';
import { isToken, isNode, TOKEN_TAGS } from '../types.js';
import type { MapperContext } from './types.js';
import { getNodeLocation } from './location-utils.js';
import { findIdentifier, findAllIdentifiers, nodeToText } from './ast-utils.js';
import { locationId } from '../../ids/index.js';

/**
 * Visit a preprocessor include directive.
 */
export function visitPreprocessorInclude(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  let includePath = '';
  for (const child of node.children) {
    if (isToken(child) && (child.tag === 'TK_StringLiteral' || child.tag === TOKEN_TAGS.STRING)) {
      includePath = child.text.replace(/^["']|["']$/g, '');
      break;
    }
  }

  context.directives.push({
    id,
    kind: 'include',
    location,
    data: { kind: 'include', path: includePath },
  });
}

/**
 * Visit a preprocessor define directive.
 */
export function visitPreprocessorDefine(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  let name = '';
  let body = '';

  // Simple approach: scan all children for the name and body
  // The name is typically in a PP_Identifier token right after `define
  for (const child of node.children) {
    if (isToken(child)) {
      // Skip the `define keyword itself
      if (child.tag === '`define' || child.text === '`define') {
        continue;
      }
      // The first PP_Identifier is the macro name
      if (!name && (child.tag === 'PP_Identifier' ||
          child.tag === 'SymbolIdentifier' ||
          child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER ||
          child.tag === 'MacroIdentifier')) {
        name = child.text;
        continue;
      }
      // PP_define_body contains the macro body
      if (name && child.tag === 'PP_define_body' && child.text) {
        body = child.text.trim();
      }
    } else if (isNode(child)) {
      // Check nested nodes for name if not found yet
      if (!name) {
        // Recursively search for identifier
        const findName = (n: VeribleNode): string | null => {
          for (const c of n.children) {
            if (isToken(c)) {
              if (c.tag === 'PP_Identifier' ||
                  c.tag === 'SymbolIdentifier' ||
                  c.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER ||
                  c.tag === 'MacroIdentifier') {
                return c.text;
              }
            } else if (isNode(c)) {
              const found = findName(c);
              if (found) return found;
            }
          }
          return null;
        };
        const foundName = findName(child);
        if (foundName) {
          name = foundName;
        }
      }
    }
  }

  // Fallback: use generic identifier finder
  if (!name) {
    name = findIdentifier(node) || '';
  }

  context.directives.push({
    id,
    kind: 'define',
    location,
    data: { kind: 'define', name, body },
  });
}

/**
 * Visit a preprocessor ifdef or ifndef directive.
 */
export function visitPreprocessorIfdef(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  let kind: 'ifdef' | 'ifndef' = 'ifdef';
  let condition = '';

  // Helper to check if a token is an identifier
  const isIdentifierToken = (tag: string, text: string): boolean => {
    return tag === 'SymbolIdentifier' ||
           tag === TOKEN_TAGS.SYMBOL_IDENTIFIER ||
           tag === 'PP_Identifier' ||
           tag === 'MacroIdentifier' ||
           (tag !== '`ifdef' && tag !== '`ifndef' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text));
  };

  for (const child of node.children) {
    if (isToken(child)) {
      if (child.tag === '`ifdef' || child.text === '`ifdef') {
        kind = 'ifdef';
      } else if (child.tag === '`ifndef' || child.text === '`ifndef') {
        kind = 'ifndef';
      } else if (!condition && isIdentifierToken(child.tag, child.text)) {
        condition = child.text;
      }
    } else if (isNode(child) && !condition) {
      // Try to extract identifier from nested node
      const extracted = findIdentifier(child);
      if (extracted) {
        condition = extracted;
      }
    }
  }

  // Fallback: use generic identifier finder
  if (!condition) {
    condition = findIdentifier(node) || '';
  }

  context.directives.push({
    id,
    kind,
    location,
    data: { kind, condition },
  });
}

/**
 * Visit a preprocessor elsif directive.
 */
export function visitPreprocessorElsif(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  let condition = '';
  for (const child of node.children) {
    if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
      condition = child.text;
      break;
    }
  }

  context.directives.push({
    id,
    kind: 'elsif',
    location,
    data: { kind: 'elsif', condition },
  });
}

/**
 * Visit a preprocessor else directive.
 */
export function visitPreprocessorElse(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  context.directives.push({
    id,
    kind: 'else',
    location,
    data: { kind: 'else' },
  });
}

/**
 * Visit a preprocessor endif directive.
 */
export function visitPreprocessorEndif(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  context.directives.push({
    id,
    kind: 'endif',
    location,
    data: { kind: 'endif' },
  });
}

/**
 * Visit a preprocessor undef directive.
 */
export function visitPreprocessorUndef(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  let name = '';
  for (const child of node.children) {
    if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
      name = child.text;
      break;
    }
  }

  context.directives.push({
    id,
    kind: 'undef',
    location,
    data: { kind: 'undef', name },
  });
}

/**
 * Visit a timescale directive.
 */
export function visitTimescale(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  // Extract time unit and precision from tokens
  const tokens: string[] = [];
  for (const child of node.children) {
    if (isToken(child) && child.text !== '`timescale') {
      tokens.push(child.text);
    }
  }

  // Format: timeUnit / precision (e.g., "1ns / 1ps")
  const fullText = tokens.join('');
  const parts = fullText.split('/');
  const timeUnit = parts[0]?.trim() || '';
  const precision = parts[1]?.trim() || '';

  context.directives.push({
    id,
    kind: 'timescale',
    location,
    data: { kind: 'timescale', timeUnit, precision },
  });
}

/**
 * Visit a default_nettype directive.
 */
export function visitDefaultNettype(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  let nettype = 'wire';
  for (const child of node.children) {
    if (isToken(child) && child.text !== '`default_nettype') {
      nettype = child.text;
      break;
    }
  }

  context.directives.push({
    id,
    kind: 'default_nettype',
    location,
    data: { kind: 'default_nettype', nettype },
  });
}

/**
 * Visit a pragma directive.
 */
export function visitPragma(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  const tokens: string[] = [];
  for (const child of node.children) {
    if (isToken(child) && child.text !== '`pragma') {
      tokens.push(child.text);
    }
  }

  context.directives.push({
    id,
    kind: 'pragma',
    location,
    data: { kind: 'pragma', text: tokens.join(' ').trim() },
  });
}

/**
 * Visit a DPI import declaration.
 *
 * Handles patterns like:
 * - import "DPI-C" function int add(int a, int b);
 * - import "DPI-C" context function void callback();
 */
export function visitDpiImport(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  let pureOrContext: string | undefined;
  let funcName = '';
  let returnType = 'void';

  // Check for pure/context keyword
  for (const child of node.children) {
    if (isToken(child)) {
      if (child.text === 'pure' || child.text === 'context') {
        pureOrContext = child.text;
      }
    }
  }

  // Extract function name and return type
  const identifiers = findAllIdentifiers(node);
  if (identifiers.length > 0) {
    funcName = identifiers[identifiers.length - 1];
  }

  // Try to find return type
  for (const child of node.children) {
    if (isToken(child)) {
      if (['int', 'void', 'real', 'string', 'byte', 'shortint', 'longint'].includes(child.text)) {
        returnType = child.text;
        break;
      }
    }
  }

  context.directives.push({
    id,
    kind: 'dpi_import',
    location,
    data: {
      kind: 'dpi_import',
      pureOrContext,
      context: pureOrContext === 'context',
      funcName,
      returnType,
      args: '',
    },
  });
}

/**
 * Visit a DPI export declaration.
 *
 * Handles patterns like:
 * - export "DPI-C" function sv_callback;
 */
export function visitDpiExport(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  const funcName = findIdentifier(node) || '';

  context.directives.push({
    id,
    kind: 'dpi_export',
    location,
    data: { kind: 'dpi_export', funcName },
  });
}
