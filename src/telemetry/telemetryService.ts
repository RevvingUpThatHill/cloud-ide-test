import * as vscode from 'vscode';
import * as TelemetryWrapper from 'vscode-extension-telemetry-wrapper';

/**
 * Telemetry service that wraps vscode-extension-telemetry-wrapper
 * Ensures API calls match the Revature extension pattern exactly
 */
export class TelemetryService {
    private static instance: TelemetryService;
    private initialized: boolean = false;

    private constructor(context: vscode.ExtensionContext, aiKey: string) {
        if (aiKey && aiKey !== 'YOUR_APPLICATION_INSIGHTS_KEY') {
            try {
                const extensionId = context.extension.id;
                const extensionVersion = context.extension.packageJSON.version;
                
                // Initialize telemetry wrapper - exact Revature pattern
                TelemetryWrapper.initialize(extensionId, extensionVersion, aiKey);
                this.initialized = true;
                
                console.log('Telemetry initialized for', extensionId);
            } catch (error) {
                console.error('Failed to initialize telemetry:', error);
            }
        }
    }

    public static initialize(context: vscode.ExtensionContext, aiKey: string): TelemetryService {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService(context, aiKey);
        }
        return TelemetryService.instance;
    }

    public static getInstance(): TelemetryService {
        if (!TelemetryService.instance) {
            throw new Error('TelemetryService not initialized. Call initialize() first.');
        }
        return TelemetryService.instance;
    }

    /**
     * Instrument a VSCode command with telemetry - matches Revature pattern
     */
    public instrumentCommand(command: string, callback: (...args: any[]) => any): vscode.Disposable {
        if (!this.initialized) {
            return vscode.commands.registerCommand(command, callback);
        }
        return TelemetryWrapper.instrumentOperationAsVsCodeCommand(command, callback);
    }

    /**
     * Create a unique operation ID
     */
    public createOperationId(): string {
        return TelemetryWrapper.createUuid();
    }

    /**
     * Send operation start event - exact Revature pattern
     */
    public sendOperationStart(operationId: string, operationName: string): void {
        if (!this.initialized) {
            return;
        }
        TelemetryWrapper.sendOperationStart(operationId, operationName);
    }

    /**
     * Send operation end event - exact Revature pattern
     */
    public sendOperationEnd(operationId: string, operationName: string, duration: number): void {
        if (!this.initialized) {
            return;
        }
        TelemetryWrapper.sendOperationEnd(operationId, operationName, duration);
    }

    /**
     * Send info event with properties and measurements - exact Revature pattern
     */
    public sendInfo(
        operationId: string,
        properties: { [key: string]: string },
        measurements?: { [key: string]: number }
    ): void {
        if (!this.initialized) {
            return;
        }
        
        try {
            if (measurements) {
                TelemetryWrapper.sendInfo(operationId, properties, measurements);
            } else {
                TelemetryWrapper.sendInfo(operationId, properties);
            }
        } catch (error) {
            console.error('Failed to send telemetry info:', error);
        }
    }

    /**
     * Send error event - exact Revature pattern
     */
    public sendError(error: Error): void {
        if (!this.initialized) {
            return;
        }
        TelemetryWrapper.sendError(error);
    }

    /**
     * Send operation error event - exact Revature pattern
     */
    public sendOperationError(operationId: string, operationName: string, error: Error): void {
        if (!this.initialized) {
            return;
        }
        TelemetryWrapper.sendOperationError(operationId, operationName, error);
    }

    /**
     * Track test execution with complete data
     * Sends telemetry in exact Revature format
     */
    public trackTestExecution(
        operationId: string,
        workspaceType: string,
        totalTests: number,
        passedTests: number,
        failedTests: number,
        skippedTests: number,
        duration: number
    ): void {
        if (!this.initialized) {
            return;
        }

        const properties = {
            workspaceType,
            result: failedTests === 0 ? 'success' : 'failure'
        };

        const measurements = {
            totalTests,
            passedTests,
            failedTests,
            skippedTests,
            durationMs: duration
        };

        this.sendInfo(operationId, properties, measurements);
    }

    /**
     * Track individual test failure with expected/actual
     */
    public trackTestFailure(
        workspaceType: string,
        testName: string,
        errorMessage?: string,
        expected?: string,
        actual?: string
    ): void {
        if (!this.initialized) {
            return;
        }

        const testOpId = this.createOperationId();
        const properties: { [key: string]: string } = {
            workspaceType,
            testName,
            errorMessage: errorMessage || ''
        };

        // Include expected/actual if available (truncate to avoid excessive data)
        if (expected) {
            properties.expected = expected.substring(0, 200);
        }
        if (actual) {
            properties.actual = actual.substring(0, 200);
        }

        this.sendInfo(testOpId, properties);
    }

    /**
     * Dispose telemetry - exact Revature pattern
     */
    public async dispose(): Promise<void> {
        if (this.initialized) {
            try {
                await TelemetryWrapper.dispose();
            } catch (error) {
                console.error('Failed to dispose telemetry:', error);
            }
        }
    }
}
