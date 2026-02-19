/**
 * Cache Module
 *
 * Provides caching infrastructure for the SystemVerilog indexer.
 *
 * ## Cache Hierarchy
 *
 * The caching system has three levels:
 *
 * 1. **ProjectIndexCache** - Master index for complete projects
 *    - Stores fully resolved project state
 *    - Enables fast startup (1-3s vs 20-60s)
 *    - Keyed by project path + file mtimes
 *
 * 2. **FileResultCache** - Per-file parse results
 *    - Stores FileUnderstanderResult per file
 *    - Keyed by file content hash
 *    - Used for incremental updates
 *
 * 3. **Tool-level caches** (SlangCache, VeribleCache)
 *    - Managed by respective tool adapters
 *    - Provide additional speedup for unchanged files
 *
 * @module cache
 */

// File result cache
export {
  FileResultCache,
  getFileResultCache,
  
  type FileResultCacheOptions,
  
  
} from './file-result-cache.js';

// Project index cache
export {
  ProjectIndexCache,
  getProjectIndexCache,
  
  
  
  
  
  
  
} from './project-index-cache.js';
