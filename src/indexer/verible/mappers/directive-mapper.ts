/**
 * Directive Mapper
 *
 * Handles preprocessor directive mapping (include, define, ifdef/ifndef).
 *
 * @module verible/mappers/directive-mapper
 */

import type { VeribleNode } from '../types.js';
import { isToken, TOKEN_TAGS } from '../types.js';
import type { MapperContext } from './types.js';
import { getNodeLocation } from './location-utils.js';
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

  // Find the include path (string literal)
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
    data: {
      kind: 'include',
      path: includePath,
    },
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

  // Find the macro name and body
  let name = '';
  let foundDefine = false;
  let foundName = false;
  const bodyParts: string[] = [];

  for (const child of node.children) {
    if (isToken(child)) {
      if (child.tag === '`define' || child.text === '`define') {
        foundDefine = true;
        continue;
      }
      if (foundDefine && !foundName && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
        name = child.text;
        foundName = true;
        continue;
      }
      // Collect body tokens after the name
      if (foundName) {
        bodyParts.push(child.text);
      }
    }
  }

  const body = bodyParts.join(' ').trim();

  context.directives.push({
    id,
    kind: 'define',
    location,
    data: {
      kind: 'define',
      name,
      body,
    },
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

  // Determine if ifdef or ifndef
  let kind: 'ifdef' | 'ifndef' = 'ifdef';
  let condition = '';

  for (const child of node.children) {
    if (isToken(child)) {
      if (child.tag === '`ifdef' || child.text === '`ifdef') {
        kind = 'ifdef';
      } else if (child.tag === '`ifndef' || child.text === '`ifndef') {
        kind = 'ifndef';
      } else if (child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
        condition = child.text;
      }
    }
  }

  context.directives.push({
    id,
    kind,
    location,
    data: {
      kind,
      condition,
    },
  });
}
