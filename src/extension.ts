import * as vscode from 'vscode';
import { TestViewProvider } from './testViewProvider';
import { TelemetryService } from './telemetry/telemetryService';
import { loadConfig, setConfig, ConfigurationError } from './config';
import { getApiClient } from './apiClient';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Cloud IDE Test extension is now active');

    try {
        // Load and validate configuration
        const packageJson = context.extension.packageJSON;
        const config = loadConfig(packageJson);
        setConfig(config);

        // Initialize telemetry service
        const telemetry = TelemetryService.initialize(
            context,
            config.telemetry.aiKey
        );

        // Register the webview provider for the sidebar
        const provider = new TestViewProvider(context.extensionUri, config.warnings, context);
        
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                'cloudIdeTestView',
                provider
            )
        );

        // Register the run tests command - wrapped with telemetry
        const runTestsCommand = telemetry.instrumentCommand(
            'cloud-ide-test.runTests',
            async () => {
                await provider.runTests();
            }
        );
        context.subscriptions.push(runTestsCommand);

        // Register session data tracking for file save events
        const apiClient = getApiClient();
        const onDidSaveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
            // Send session data to API (asynchronously)
            apiClient.sendSessionData('onDidSaveTextDocument').catch(error => {
                console.error('Failed to send session data:', error);
            });
        });
        context.subscriptions.push(onDidSaveDisposable);

        // Track workspace open event
        apiClient.sendSessionData('onWorkspaceOpen').catch(error => {
            console.error('Failed to send initial session data:', error);
        });

        // Register telemetry disposal
        context.subscriptions.push({
            dispose: async () => {
                await telemetry.dispose();
            }
        });

        console.log(`Cloud IDE Test extension activated for ${config.workspaceType} workspace`);
        
        // Show warnings to user if any
        if (config.warnings.length > 0) {
            if (config.warnings.length === 1) {
                // Single warning - show directly
                vscode.window.showWarningMessage(
                    `Cloud IDE Test: ${config.warnings[0]}`
                );
            } else {
                // Multiple warnings - consolidate with bullet points
                const warningList = config.warnings.map(w => `• ${w}`).join('\n');
                vscode.window.showWarningMessage(
                    `Cloud IDE Test: Configuration Warnings:\n\n${warningList}`
                );
            }
        }
    } catch (error) {
        if (error instanceof ConfigurationError) {
            // Check if there are multiple errors in the message
            const errorLines = error.message.split('\n').filter(line => line.trim().startsWith('-'));
            
            if (errorLines.length > 1) {
                // Multiple errors - consolidate with bullet points
                const errorList = errorLines.map(line => `• ${line.trim().substring(1).trim()}`).join('\n');
                vscode.window.showErrorMessage(
                    `Cloud IDE Test: Configuration Errors:\n\n${errorList}`
                );
            } else {
                // Single error or no structured errors
                vscode.window.showErrorMessage(
                    `Cloud IDE Test: Configuration Error - ${error.message}`
                );
            }
            console.error('Extension activation failed:', error.message);
            throw error; // Fail fast - prevent extension from loading
        }
        throw error;
    }
}

export async function deactivate() {
    console.log('Cloud IDE Test extension is now deactivated');
    await TelemetryService.getInstance().dispose();
}
