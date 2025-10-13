import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    TestAdapter,
    TestResult,
    JavaTestAdapter,
    AngularTestAdapter,
    PythonTestAdapter
} from './adapters';
import { TelemetryService } from './telemetry/telemetryService';
import { getConfig } from './config';

export class TestViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private workspaceType: string;
    private testAdapter: TestAdapter;

    constructor(private readonly _extensionUri: vscode.Uri) {
        // Get configuration (already validated at extension startup)
        const config = getConfig();
        this.workspaceType = config.workspaceType;
        
        // Initialize the appropriate test adapter
        this.testAdapter = this.getTestAdapter(config.workspaceType);
    }

    private getTestAdapter(workspaceType: 'Java' | 'Angular' | 'Python'): TestAdapter {
        switch (workspaceType) {
            case 'Java':
                return new JavaTestAdapter();
            case 'Angular':
                return new AngularTestAdapter();
            case 'Python':
                return new PythonTestAdapter();
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'runTests':
                    await this.runTests();
                    break;
            }
        });
    }

    public async runTests() {
        if (!this._view) {
            vscode.window.showErrorMessage('Test view not initialized');
            return;
        }

        // Get the currently open directory
        const activeEditor = vscode.window.activeTextEditor;
        let testDirectory = '';

        if (activeEditor) {
            testDirectory = vscode.workspace.getWorkspaceFolder(
                activeEditor.document.uri
            )?.uri.fsPath || '';
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            testDirectory = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }

        if (!testDirectory) {
            this._view.webview.postMessage({
                type: 'testError',
                error: 'No workspace folder found. Please open a folder or workspace to run tests.'
            });
            return;
        }

        // Update UI to show loading state
        this._view.webview.postMessage({
            type: 'testRunning',
            workspaceType: this.workspaceType
        });

        const telemetry = TelemetryService.getInstance();
        const operationId = telemetry.createOperationId();
        telemetry.sendOperationStart(operationId, 'test.execution');
        const startTime = Date.now();
        
        try {
            // Run tests using the appropriate test adapter
            const results = await this.testAdapter.runTests(testDirectory);
            const duration = Date.now() - startTime;

            // Send telemetry with complete test data - exact Revature pattern
            telemetry.trackTestExecution(
                operationId,
                this.workspaceType,
                results.totalTests,
                results.passedTests,
                results.failedTests,
                results.skippedTests,
                duration
            );

            // Track individual failed tests with expected/actual details
            for (const test of results.tests) {
                if (test.status === 'failed') {
                    telemetry.trackTestFailure(
                        this.workspaceType,
                        test.name,
                        test.message,
                        test.expected,
                        test.actual
                    );
                }
            }

            telemetry.sendOperationEnd(operationId, 'test.execution', duration);

            // Send results back to the webview
            this._view.webview.postMessage({
                type: 'testResults',
                results: results,
                workspaceType: this.workspaceType
            });
        } catch (error) {
            const duration = Date.now() - startTime;
            
            // Track error - exact Revature pattern
            const err = error instanceof Error ? error : new Error(String(error));
            telemetry.sendOperationError(operationId, 'test.execution', err);
            telemetry.sendOperationEnd(operationId, 'test.execution', duration);

            vscode.window.showErrorMessage(`Test execution failed: ${error}`);
            this._view.webview.postMessage({
                type: 'testError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Load the HTML, CSS, and JS from separate files
        const webviewPath = path.join(__dirname, 'webview');
        
        const htmlTemplate = fs.readFileSync(path.join(webviewPath, 'testView.html'), 'utf8');
        const cssContent = fs.readFileSync(path.join(webviewPath, 'testView.css'), 'utf8');
        const jsContent = fs.readFileSync(path.join(webviewPath, 'testView.js'), 'utf8');
        
        // Replace placeholders in the HTML template
        const html = htmlTemplate
            .replace('__STYLES__', cssContent)
            .replace('__SCRIPT__', jsContent)
            .replace('__WORKSPACE_TYPE__', this.workspaceType);
        
        return html;
    }
}

