/**
 * API Module - Barrel export for cleaner imports
 * 
 * Usage:
 *   import { getApiClient, TestExecutionData } from './api';
 */

// Export the main API interface and types
export * from './lmsClient.interface';

// Export factory and utilities
export * from './apiClientFactory';

// Export client implementations (usually not needed externally, but available if needed)
export { EvolvApiClient } from './evolvApiClient';
export { RevatureApiClient } from './revatureApiClient';

