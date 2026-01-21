import { ModelCapabilityService } from './ModelCapabilityService.js';

export { ModelCapabilityService } from './ModelCapabilityService.js';
export { fetchModelCapabilities } from './openrouter-fetcher.js';
export type { ModelCapabilities, CapabilityCache } from './types.js';
export { DEFAULT_CAPABILITIES, CACHE_TTL_MS, CACHE_VERSION } from './types.js';

// Singleton export
export const modelCapabilities = new ModelCapabilityService();
