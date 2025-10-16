/**
 * Configuration module - Loads configuration from .lab.json and environment variables
 * Validates all required configuration on extension startup
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LabConfig {
    workspaceType: 'Java' | 'Angular' | 'Python';
}

export interface ExtensionConfig {
    // Workspace configuration
    workspaceType: 'Java' | 'Angular' | 'Python';
    
    // Telemetry configuration
    telemetry: {
        enabled: boolean;
        aiKey: string;
        endpoint: string;
    };
    
    // Revature API configuration
    api: {
        enabled: boolean;
        baseUrl: string;
    };
    
    // Extension metadata
    extensionId: string;
    extensionVersion: string;
    
    // Configuration warnings (non-fatal issues)
    warnings: string[];
}

/**
 * Configuration error thrown when required config is missing or invalid
 */
export class ConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigurationError';
    }
}

/**
 * Load .lab.json configuration from workspace root
 */
function loadLabConfig(): { workspaceType: string | null; warning: string | null } {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return { 
            workspaceType: null, 
            warning: 'No workspace folder found. Defaulting to "Python (default)".' 
        };
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const labConfigPath = path.join(workspaceRoot, '.lab.json');

    if (!fs.existsSync(labConfigPath)) {
        return { 
            workspaceType: null, 
            warning: '.lab.json file not found in workspace root. Defaulting to "Python (default)". Create a .lab.json file with {"workspaceType": "Java"}, {"workspaceType": "Angular"}, or {"workspaceType": "Python"}.' 
        };
    }

    try {
        const fileContent = fs.readFileSync(labConfigPath, 'utf8');
        const labConfig: LabConfig = JSON.parse(fileContent);

        if (!labConfig.workspaceType) {
            return { 
                workspaceType: null, 
                warning: '.lab.json is missing "workspaceType" property. Defaulting to "Python (default)".' 
            };
        }

        if (!['Java', 'Angular', 'Python'].includes(labConfig.workspaceType)) {
            return { 
                workspaceType: null, 
                warning: `.lab.json has invalid workspaceType "${labConfig.workspaceType}". Must be "Java", "Angular", or "Python". Defaulting to "Python (default)".` 
            };
        }

        return { workspaceType: labConfig.workspaceType, warning: null };
    } catch (error) {
        return { 
            workspaceType: null, 
            warning: `.lab.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}. Defaulting to "Python (default)".` 
        };
    }
}

/**
 * Check if .revature file exists
 */
function checkRevatureConfig(): string | null {
    const possiblePaths = [
        '/home/ubuntu/.revature',
        '/root/.revature',
        path.join(os.homedir(), '.revature')
    ];

    for (const configPath of possiblePaths) {
        try {
            if (fs.existsSync(configPath)) {
                return null; // File found, no warning
            }
        } catch (error) {
            // Ignore errors, continue checking
        }
    }

    // File not found in any location
    return '.revature configuration file not found. Cloud lab API integration will be disabled. Running in local development mode.';
}

/**
 * Load and validate configuration from .lab.json and environment variables
 * Defaults to Python if .lab.json is not found or invalid
 */
export function loadConfig(packageJson: any): ExtensionConfig {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Load workspace type from .lab.json (defaults to Python)
    const labConfigResult = loadLabConfig();
    let workspaceType = labConfigResult.workspaceType || 'Python';
    
    if (labConfigResult.warning) {
        warnings.push(labConfigResult.warning);
    }

    // Check for .revature file
    const revatureWarning = checkRevatureConfig();
    if (revatureWarning) {
        warnings.push(revatureWarning);
    }

    // Load telemetry configuration from environment variables
    const aiKey = process.env.TELEMETRY_AI_KEY || '';
    const telemetryEnabled = aiKey !== '';
    const telemetryEndpoint = process.env.TELEMETRY_ENDPOINT || 'https://dc.services.visualstudio.com/v2/track';

    // Validate telemetry endpoint format
    if (telemetryEnabled && !isValidUrl(telemetryEndpoint)) {
        errors.push(`TELEMETRY_ENDPOINT must be a valid URL, got: "${telemetryEndpoint}"`);
    }

    // Load Revature API configuration from environment variables
    const apiBaseUrl = process.env.REVATURE_API_BASE_URL || 'https://dev-api.evolvtalent.ai';
    const apiEnabled = process.env.REVATURE_API_ENABLED !== 'false'; // Enabled by default

    // Validate API base URL format
    if (apiEnabled && !isValidUrl(apiBaseUrl)) {
        errors.push(`REVATURE_API_BASE_URL must be a valid URL, got: "${apiBaseUrl}"`);
    }

    // Load extension metadata (REQUIRED)
    const extensionId = packageJson.name;
    const extensionVersion = packageJson.version;
    
    if (!extensionId) {
        errors.push('Extension ID (package.json name) is required');
    }
    if (!extensionVersion) {
        errors.push('Extension version (package.json version) is required');
    }

    // Fail fast if there are any errors
    if (errors.length > 0) {
        throw new ConfigurationError(
            `Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
        );
    }

    const config: ExtensionConfig = {
        workspaceType: workspaceType as 'Java' | 'Angular' | 'Python',
        telemetry: {
            enabled: telemetryEnabled,
            aiKey: aiKey,
            endpoint: telemetryEndpoint
        },
        api: {
            enabled: apiEnabled,
            baseUrl: apiBaseUrl
        },
        extensionId,
        extensionVersion,
        warnings
    };

    // Log loaded configuration (mask sensitive data)
    console.log('Configuration loaded:', {
        workspaceType: config.workspaceType,
        telemetry: {
            enabled: config.telemetry.enabled,
            aiKey: maskSensitiveData(config.telemetry.aiKey),
            endpoint: config.telemetry.endpoint
        },
        api: {
            enabled: config.api.enabled,
            baseUrl: config.api.baseUrl
        },
        extensionId: config.extensionId,
        extensionVersion: config.extensionVersion,
        warnings: config.warnings
    });

    // Log warnings if any
    if (warnings.length > 0) {
        console.warn('Configuration warnings:', warnings);
    }

    return config;
}

/**
 * Validate URL format
 */
function isValidUrl(urlString: string): boolean {
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Mask sensitive data for logging (show first and last 4 chars)
 */
function maskSensitiveData(value: string): string {
    if (value === '') {
        return '(not set)';
    }
    if (value.length <= 8) {
        return '****';
    }
    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
}

/**
 * Get configuration value with type safety
 * Use this to access config throughout the extension
 */
let cachedConfig: ExtensionConfig | null = null;

export function getConfig(): ExtensionConfig {
    if (!cachedConfig) {
        throw new ConfigurationError('Configuration not initialized. Call loadConfig() first.');
    }
    return cachedConfig;
}

export function setConfig(config: ExtensionConfig): void {
    cachedConfig = config;
}

