/**
 * Location Utilities for CST Mapping
 *
 * Contains functions for converting CST positions to Location objects.
 *
 * @module verible/mappers/location-utils
 */

import type { VeribleNode } from '../types.js';
import type { Location } from '../../types/location.js';
import type { MapperContext } from './types.js';
import { findFirstToken } from './ast-utils.js';

/**
 * Convert byte offset to line/column.
 */
function offsetToLineCol(offset: number, lineOffsets: number[]): { line: number; col: number } {
  // Binary search for line
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineOffsets[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const line = low + 1; // 1-based
  const col = offset - lineOffsets[low] + 1; // 1-based
  return { line, col };
}

/**
 * Get the location of a node.
 */
export function getNodeLocation(node: VeribleNode, context: MapperContext): Location {
  const firstToken = findFirstToken(node);
  if (firstToken) {
    const { line, col } = offsetToLineCol(firstToken.start, context.lineOffsets);
    return { file: context.filePath, line, col };
  }
  return { file: context.filePath, line: 1, col: 1 };
}
