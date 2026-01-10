/**
 * AST Utilities for CST Navigation
 *
 * Contains helper functions for navigating and extracting data from Verible's CST.
 *
 * @module verible/mappers/ast-utils
 */

import type { VeribleNode, VeribleToken } from '../types.js';
import { isNode, isToken, NODE_TAGS, TOKEN_TAGS } from '../types.js';

/**
 * Find the first identifier in a node.
 * Searches for SymbolIdentifier tokens in common locations.
 */
export function findIdentifier(node: VeribleNode): string | undefined {
  for (const child of node.children) {
    // Check for identifier tokens (various tag names Verible uses)
    if (isToken(child)) {
      if (child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER ||
          child.tag === 'SymbolIdentifier') {
        return child.text;
      }
    }
    if (isNode(child)) {
      // Check kUnqualifiedId nodes
      if (child.tag === NODE_TAGS.UNQUALIFIED_ID || child.tag === 'kUnqualifiedId') {
        const id = findIdentifier(child);
        if (id) return id;
      }
      // Check header nodes (kModuleHeader, kFunctionHeader, etc.)
      if (child.tag.includes('Header')) {
        const id = findIdentifier(child);
        if (id) return id;
      }
      // Check kParamType for parameters
      if (child.tag === 'kParamType') {
        const id = findIdentifier(child);
        if (id) return id;
      }
      // Check kTypeInfo for type declarations
      if (child.tag === 'kTypeInfo') {
        const id = findIdentifier(child);
        if (id) return id;
      }
    }
  }
  return undefined;
}

/**
 * Find the first identifier anywhere in the tree.
 */
export function findFirstIdentifier(node: VeribleNode): string | undefined {
  for (const child of node.children) {
    if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
      return child.text;
    }
    if (isNode(child)) {
      const id = findFirstIdentifier(child);
      if (id) return id;
    }
  }
  return undefined;
}

/**
 * Find all identifiers in a node.
 */
export function findAllIdentifiers(node: VeribleNode): string[] {
  const ids: string[] = [];
  for (const child of node.children) {
    if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
      ids.push(child.text);
    }
    if (isNode(child)) {
      ids.push(...findAllIdentifiers(child));
    }
  }
  return ids;
}

/**
 * Find a child node by tag.
 */
export function findChildByTag(node: VeribleNode, tag: string): VeribleNode | undefined {
  for (const child of node.children) {
    if (isNode(child) && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

/**
 * Find the first token in a node.
 */
export function findFirstToken(node: VeribleNode): VeribleToken | undefined {
  for (const child of node.children) {
    if (isToken(child)) {
      return child;
    }
    if (isNode(child)) {
      const token = findFirstToken(child);
      if (token) return token;
    }
  }
  return undefined;
}

/**
 * Check if a node contains a specific keyword.
 */
export function hasKeyword(node: VeribleNode, keyword: string): boolean {
  for (const child of node.children) {
    if (isToken(child) && child.text === keyword) {
      return true;
    }
    if (isNode(child) && hasKeyword(child, keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * Find a label (for generate blocks).
 */
export function findLabel(node: VeribleNode): string | undefined {
  // Labels are typically identifier followed by colon
  for (let i = 0; i < node.children.length - 1; i++) {
    const child = node.children[i];
    const next = node.children[i + 1];
    if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
      if (isToken(next) && next.text === ':') {
        return child.text;
      }
    }
  }
  return undefined;
}

/**
 * Convert a node to its text representation.
 */
export function nodeToText(node: VeribleNode): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (isToken(child)) {
      parts.push(child.text);
    } else if (isNode(child)) {
      parts.push(nodeToText(child));
    }
  }
  return parts.join(' ').trim();
}

/**
 * Extract data type from a declaration.
 */
export function extractDataType(node: VeribleNode): string {
  const typeNode = findChildByTag(node, NODE_TAGS.DATA_TYPE);
  if (typeNode) {
    return nodeToText(typeNode);
  }
  return 'logic'; // Default
}

/**
 * Extract base type for typedef.
 */
export function extractBaseType(node: VeribleNode): string {
  const typeNode = findChildByTag(node, NODE_TAGS.DATA_TYPE);
  if (typeNode) {
    return nodeToText(typeNode);
  }
  return '';
}

/**
 * Extract return type from function.
 */
export function extractReturnType(node: VeribleNode): string {
  const header = findChildByTag(node, NODE_TAGS.FUNCTION_HEADER);
  if (header) {
    const typeNode = findChildByTag(header, NODE_TAGS.DATA_TYPE);
    if (typeNode) {
      return nodeToText(typeNode);
    }
  }
  return 'void';
}

/**
 * Extract default value from parameter.
 */
export function extractDefaultValue(node: VeribleNode): string | undefined {
  // Look for = followed by expression
  let foundEquals = false;
  for (const child of node.children) {
    if (isToken(child) && child.text === '=') {
      foundEquals = true;
      continue;
    }
    if (foundEquals && isNode(child)) {
      return nodeToText(child);
    }
    if (foundEquals && isToken(child) && child.tag !== TOKEN_TAGS.SEMICOLON) {
      return child.text;
    }
  }
  return undefined;
}

/**
 * Extract port direction.
 */
export function extractPortDirection(node: VeribleNode): 'input' | 'output' | 'inout' | 'ref' {
  for (const child of node.children) {
    if (isToken(child)) {
      if (child.text === 'input') return 'input';
      if (child.text === 'output') return 'output';
      if (child.text === 'inout') return 'inout';
      if (child.text === 'ref') return 'ref';
    }
  }
  return 'input'; // Default
}

/**
 * Extract function/task arguments.
 */
export function extractFunctionArgs(node: VeribleNode): Array<{
  name: string;
  direction: 'input' | 'output' | 'inout' | 'ref';
  type: string;
}> {
  const args: Array<{ name: string; direction: 'input' | 'output' | 'inout' | 'ref'; type: string }> = [];
  // Look for port declarations within function/task
  for (const child of node.children) {
    if (isNode(child) && child.tag === NODE_TAGS.PORT_DECLARATION_LIST) {
      for (const portChild of child.children) {
        if (isNode(portChild) && portChild.tag === NODE_TAGS.PORT_DECLARATION) {
          const name = findIdentifier(portChild);
          if (name) {
            args.push({
              name,
              direction: extractPortDirection(portChild),
              type: extractDataType(portChild),
            });
          }
        }
      }
    }
  }
  return args;
}

/**
 * Extract parameters from a module/interface header.
 */
export function extractParameters(node: VeribleNode): Array<{
  name: string;
  type?: string;
  default?: string;
}> {
  const params: Array<{ name: string; type?: string; default?: string }> = [];
  const paramList = findChildByTag(node, NODE_TAGS.PARAMETER_PORT_LIST);
  if (!paramList) return params;

  // Find all parameter declarations in the list
  for (const child of paramList.children) {
    if (isNode(child) && (child.tag === NODE_TAGS.PARAMETER_DECLARATION || child.tag === 'kParamDeclaration')) {
      const name = findIdentifier(child);
      if (name) {
        params.push({
          name,
          type: extractDataType(child),
          default: extractDefaultValue(child),
        });
      }
    }
  }

  return params;
}

/**
 * Find instance names in module instantiation.
 * Handles Verible's structure: kInstantiationBase -> kGateInstanceRegisterVariableList -> kGateInstance
 */
export function findInstanceNames(node: VeribleNode): string[] {
  const names: string[] = [];

  // Look for kGateInstanceRegisterVariableList which contains kGateInstance nodes
  const gateListNode = findChildByTag(node, NODE_TAGS.GATE_INSTANCE_LIST);
  if (gateListNode) {
    for (const child of gateListNode.children) {
      if (isNode(child) && (child.tag === NODE_TAGS.INSTANCE_NAME || child.tag === 'kGateInstance')) {
        const name = findIdentifier(child);
        if (name) names.push(name);
      }
    }
  }

  // Fallback: look for NODE_TAGS.INSTANCE_NAME directly
  if (names.length === 0) {
    const instanceNode = findChildByTag(node, NODE_TAGS.INSTANCE_NAME);
    if (instanceNode) {
      const name = findIdentifier(instanceNode);
      if (name) names.push(name);
    }
  }

  // Fallback: look for identifiers that are not the module type
  if (names.length === 0) {
    const allIds = findAllIdentifiers(node);
    if (allIds.length > 1) {
      names.push(allIds[1]); // Second identifier is typically the instance name
    }
  }

  return names;
}

/**
 * Extract parameter overrides from instantiation.
 */
export function extractParameterOverrides(node: VeribleNode): Record<string, string> {
  const overrides: Record<string, string> = {};
  const paramNode = findChildByTag(node, NODE_TAGS.PARAMETER_VALUE_ASSIGNMENT);
  if (paramNode) {
    // Extract named parameter assignments
    for (const child of paramNode.children) {
      if (isNode(child)) {
        const ids = findAllIdentifiers(child);
        if (ids.length >= 2) {
          overrides[ids[0]] = ids[1];
        }
      }
    }
  }
  return overrides;
}
