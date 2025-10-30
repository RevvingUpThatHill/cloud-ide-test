/**
 * API Client Factory
 * Creates the appropriate LMS API client based on the API_BASE_URL configuration
 * 
 * - evolvtalent.ai → EvolvApiClient
 * - revature.com → RevatureApiClient
 */

import { LMSApiClient } from './lmsClient.interface';
import { EvolvApiClient } from './evolvApiClient';
import { RevatureApiClient } from './revatureApiClient';
import { readRevatureConfig } from '../revatureConfig';
import { getConfig } from '../config';

// Singleton instance
let apiClientInstance: LMSApiClient | null = null;

/**
 * Get or create the appropriate API client based on configuration
 * Returns a singleton instance
 */
export function getApiClient(): LMSApiClient {
    if (!apiClientInstance) {
        apiClientInstance = createApiClient();
    }
    return apiClientInstance;
}

/**
 * Reset the API client singleton (useful for testing or config changes)
 */
export function resetApiClient(): void {
    apiClientInstance = null;
}

/**
 * Create the appropriate API client based on API_BASE_URL
 */
function createApiClient(): LMSApiClient {
    try {
        // Get configuration
        const config = getConfig();
        const revatureConfig = readRevatureConfig();
        
        // Determine base URL
        // Priority: .revature file > environment variable > extension config default
        const baseUrl = revatureConfig?.API_BASE_URL || 
                       config.api.baseUrl || 
                       'https://dev-api.evolvtalent.ai';
        
        const enabled = config.api.enabled;
        
        console.log(`[ApiClientFactory] Creating API client for: ${baseUrl}`);
        console.log(`[ApiClientFactory] API enabled: ${enabled}`);
        
        // Route to correct implementation based on base URL
        if (baseUrl.includes('revature.com')) {
            console.log('[ApiClientFactory] Using Revature API client');
            return new RevatureApiClient(baseUrl, enabled);
        } else if (baseUrl.includes('evolvtalent.ai')) {
            console.log('[ApiClientFactory] Using Evolv API client');
            return new EvolvApiClient(baseUrl, enabled);
        } else {
            // Default to Evolv for unknown URLs
            console.warn(`[ApiClientFactory] Unknown base URL: ${baseUrl}, defaulting to Evolv client`);
            return new EvolvApiClient(baseUrl, enabled);
        }
        
    } catch (error) {
        console.error('[ApiClientFactory] Failed to create API client:', error);
        // Return disabled Evolv client as fallback
        return new EvolvApiClient('https://dev-api.evolvtalent.ai', false);
    }
}

/**
 * Determine which API implementation is being used
 */
export function getApiClientType(): 'evolv' | 'revature' | 'unknown' {
    const client = getApiClient();
    const baseUrl = client.getBaseUrl();
    
    if (baseUrl.includes('revature.com')) {
        return 'revature';
    } else if (baseUrl.includes('evolvtalent.ai')) {
        return 'evolv';
    } else {
        return 'unknown';
    }
}

