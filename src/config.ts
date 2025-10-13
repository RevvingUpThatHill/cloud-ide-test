/**
 * Configuration module - Fail-fast loading of environment variables and constants
 * Validates all required configuration on extension startup
 */

export interface ExtensionConfig {
    // Workspace configuration
    workspaceType: 'Java' | 'Angular' | 'Python';
    
    // Telemetry configuration
    telemetry: {
        enabled: boolean;
        aiKey: string;
        endpoint: string;
    };
    
    // Extension metadata
    extensionId: string;
    extensionVersion: string;
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
 * Load and validate configuration from environment variables and package.json
 * Fails fast if required configuration is missing or invalid
 */
export function loadConfig(packageJson: any): ExtensionConfig {
    const errors: string[] = [];

    // Load workspace type (REQUIRED)
    const workspaceType = process.env.workspace_type?.trim();
    if (!workspaceType) {
        errors.push('workspace_type environment variable is required (must be "Java", "Angular", or "Python")');
    } else if (!['Java', 'Angular', 'Python'].includes(workspaceType)) {
        errors.push(`workspace_type must be "Java", "Angular", or "Python", got: "${workspaceType}"`);
    }

    // Load telemetry configuration
    const aiKey = packageJson.aiKey || process.env.TELEMETRY_AI_KEY || 'YOUR_APPLICATION_INSIGHTS_KEY';
    const telemetryEnabled = aiKey !== 'YOUR_APPLICATION_INSIGHTS_KEY';
    const telemetryEndpoint = process.env.TELEMETRY_ENDPOINT || 'https://dc.services.visualstudio.com/v2/track';

    // Validate telemetry endpoint format
    if (telemetryEnabled && !isValidUrl(telemetryEndpoint)) {
        errors.push(`TELEMETRY_ENDPOINT must be a valid URL, got: "${telemetryEndpoint}"`);
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
        extensionId,
        extensionVersion
    };

    // Log loaded configuration (mask sensitive data)
    console.log('Configuration loaded:', {
        workspaceType: config.workspaceType,
        telemetry: {
            enabled: config.telemetry.enabled,
            aiKey: maskSensitiveData(config.telemetry.aiKey),
            endpoint: config.telemetry.endpoint
        },
        extensionId: config.extensionId,
        extensionVersion: config.extensionVersion
    });

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
    if (value === 'YOUR_APPLICATION_INSIGHTS_KEY') {
        return value;
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

