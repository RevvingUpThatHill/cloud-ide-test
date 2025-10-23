/**
 * Utility to read and parse the .revature configuration file
 * This file is created by the setup script and contains environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RevatureConfig {
    GIT_ACCESS_TOKEN: string;
    GIT_USERNAME: string;
    GITHUB_TOKEN: string;
    GITHUB_USERNAME: string;
    REPO_URL: string;
    REPO_NAME: string;
    REPO_PATH: string;
    USER_IP: string;
    HOST: string;
    LEARNER_CURRICULUM_ACTIVITY_ID: string;
    ACTIVITY_TYPE: string;
    WORKSPACE_CONTEXT_URL: string;
    CLOUD_LAB_WORKSPACE_ID: string;
    LEARNER_WORK_OS_ID: string;
    TOKEN: string;
    API_KEY?: string; // Optional API key for Revature Cloud Lab API
    API_BASE_URL?: string; // Optional API base URL (defaults to https://dev-api.evolvtalent.ai)
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

        // Validate required fields
        const requiredFields: (keyof RevatureConfig)[] = [
            'CLOUD_LAB_WORKSPACE_ID',
            'LEARNER_CURRICULUM_ACTIVITY_ID',
            'ACTIVITY_TYPE'
        ];

        for (const field of requiredFields) {
            if (!config[field]) {
                console.warn(`.revature config is missing required field: ${field}`);
            }
        }

        return config as RevatureConfig;
    } catch (error) {
        console.error(`Failed to parse .revature config from ${configPath}:`, error);
        return null;
    }
}

/**
 * Get a specific value from the Revature config
 */
export function getRevatureConfigValue(key: keyof RevatureConfig): string | undefined | null {
    const config = readRevatureConfig();
    return config ? config[key] : null;
}

