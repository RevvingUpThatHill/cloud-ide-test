/**
 * Utility to read and parse the .revature configuration file
 * This file is created by the setup script and contains environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RevatureConfig {
    // Git configuration
    GIT_ACCESS_TOKEN: string;
    GIT_USERNAME: string;
    GITHUB_TOKEN: string;
    GITHUB_USERNAME: string;
    REPO_URL: string;
    REPO_NAME: string;
    REPO_PATH: string;
    USER_IP: string;
    HOST: string;
    
    // Evolv-specific fields (evolvtalent.ai API)
    LEARNER_CURRICULUM_ACTIVITY_ID?: string;
    ACTIVITY_TYPE?: string;
    WORKSPACE_CONTEXT_URL?: string;
    CLOUD_LAB_WORKSPACE_ID?: string;
    LEARNER_WORK_OS_ID?: string;
    
    // Revature-specific fields (revature.com API)
    REVPRO_WORKSPACE_ID?: string;
    PROJECT_TYPE?: string; // Also referred to as projectCode in API
    TRAINEE_CODING_LAB_ID?: string;
    INTERN_ID?: string;
    GITPOD_WORKSPACE_CONTEXT_URL?: string;
    
    // Common fields
    TOKEN: string;
    API_KEY?: string; // API key for cloud lab API
    API_BASE_URL?: string; // Base URL determines which implementation to use
}

/**
 * Read and parse the .revature configuration file
 * Tries multiple locations: /home/ubuntu/.revature, /root/.revature, ~/.revature
 */
export function readRevatureConfig(): RevatureConfig | null {
    const possiblePaths = [
        '/home/ubuntu/.revature',
        '/root/.revature',
        path.join(os.homedir(), '.revature')
    ];

    for (const configPath of possiblePaths) {
        try {
            if (fs.existsSync(configPath)) {
                console.log(`Found .revature config at: ${configPath}`);
                return parseRevatureConfig(configPath);
            }
        } catch (error) {
            console.warn(`Failed to read .revature from ${configPath}:`, error);
        }
    }

    console.warn('.revature configuration file not found in any standard location');
    return null;
}

/**
 * Parse the .revature configuration file
 * Format: KEY="value" (bash-style environment variable export)
 */
function parseRevatureConfig(configPath: string): RevatureConfig | null {
    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config: Partial<RevatureConfig> = {};

        // Parse each line
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // Parse KEY="value" or KEY=value format
            const match = trimmed.match(/^([A-Z_]+)="?([^"]*)"?$/);
            if (match) {
                const key = match[1];
                let value = match[2];
                
                // Decode Base64-encoded fields (these are encoded in the .revature file)
                const base64Fields = ['CLOUD_LAB_WORKSPACE_ID', 'LEARNER_CURRICULUM_ACTIVITY_ID', 'ACTIVITY_TYPE'];
                if (base64Fields.includes(key) && value) {
                    try {
                        value = Buffer.from(value, 'base64').toString('utf8');
                        console.log(`Decoded ${key}: ${value}`);
                    } catch (error) {
                        console.warn(`Failed to decode Base64 for ${key}, using original value`);
                    }
                }
                
                (config as any)[key] = value;
            }
        }

        // Note: We don't validate required fields here because they differ between
        // Evolv (CLOUD_LAB_WORKSPACE_ID, LEARNER_CURRICULUM_ACTIVITY_ID, ACTIVITY_TYPE)
        // and Revature (REVPRO_WORKSPACE_ID, PROJECT_TYPE).
        // The actual API clients validate their specific required fields when making requests.
        
        return config as RevatureConfig;
    } catch (error) {
        console.error(`Failed to parse .revature config from ${configPath}:`, error);
        return null;
    }
}

