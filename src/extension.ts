import * as vscode from 'vscode';
import { TestViewProvider } from './testViewProvider';
import { TelemetryService } from './telemetry/telemetryService';
import { loadConfig, setConfig, ConfigurationError } from './config';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Cloud IDE Test extension is now active');

    try {
        // Load and validate configuration - FAIL FAST
        const packageJson = context.extension.packageJSON;
        const config = loadConfig(packageJson);
        setConfig(config);

        // Initialize telemetry service
        const telemetry = TelemetryService.initialize(
            context,
            config.telemetry.aiKey
        );

        // Register the webview provider for the sidebar
        const provider = new TestViewProvider(context.extensionUri);
        
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

        // Register telemetry disposal
        context.subscriptions.push({
            dispose: async () => {
                await telemetry.dispose();
            }
        });

        console.log(`Cloud IDE Test extension activated for ${config.workspaceType} workspace`);
    } catch (error) {
        if (error instanceof ConfigurationError) {
            // Show user-friendly error message
            vscode.window.showErrorMessage(
                `Cloud IDE Test: Configuration Error - ${error.message}`
            );
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
