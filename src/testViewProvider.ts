import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
    TestAdapter,
    TestResult,
    JavaTestAdapter,
    AngularTestAdapter,
    PythonTestAdapter
} from './adapters';
import { TelemetryService } from './telemetry/telemetryService';
import { getConfig } from './config';
import { getApiClient } from './apiClient';
import { commitAndPushTestResults, isGitRepository } from './gitHelper';

const execAsync = promisify(exec);

export class TestViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private workspaceType: string;
    private testAdapter: TestAdapter;
    private configWarnings: string[];
    private workspaceTypeDisplay: string;

    constructor(private readonly _extensionUri: vscode.Uri, configWarnings: string[] = []) {
        // Get configuration (already validated at extension startup)
        const config = getConfig();
        this.workspaceType = config.workspaceType;
        this.configWarnings = configWarnings;
        
        // Determine display name (add "default" label if workspace_type was not set)
        const hasWorkspaceTypeWarning = configWarnings.some(w => w.includes('workspace_type'));
        this.workspaceTypeDisplay = hasWorkspaceTypeWarning 
            ? `${config.workspaceType} (default)` 
            : config.workspaceType;
        
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

        // Send configuration warnings to webview if any
        if (this.configWarnings.length > 0) {
            // Use setTimeout to ensure the webview is fully loaded
            setTimeout(() => {
                webviewView.webview.postMessage({
                    type: 'configWarning',
                    warning: this.configWarnings.join('\n')
                });
            }, 100);
        }

        // Discover and display tests on load
        setTimeout(() => {
            this.discoverAndDisplayTests();
        }, 200);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'runTests':
                    await this.runTests();
                    break;
            }
        });
    }

    private async discoverAndDisplayTests() {
        if (!this._view) {
            return;
        }

        const testDirectory = this.getTestDirectory();
        if (!testDirectory) {
            return;
        }

        try {
            const discoveredTests = await this.testAdapter.discoverTests(testDirectory);
            
            // Make test files read-only
            await this.makeTestFilesReadOnly(discoveredTests.map(t => t.filePath));
            
            // Send discovered tests to webview with initial "not-run" state
            this._view.webview.postMessage({
                type: 'testsDiscovered',
                tests: discoveredTests.map(test => ({
                    name: test.name,
                    filePath: test.filePath,
                    state: 'not-run'
                }))
            });
        } catch (error) {
            console.error('Failed to discover tests:', error);
        }
    }

    private async makeTestFilesReadOnly(testFilePaths: string[]): Promise<void> {
        for (const filePath of testFilePaths) {
            try {
                // Use sudo chmod to set read-only (444 = r--r--r--)
                await execAsync(`sudo chmod 444 "${filePath}"`);
                console.log(`Made test file read-only: ${filePath}`);
            } catch (error) {
                console.warn(`Failed to make test file read-only: ${filePath}`, error);
                // Continue even if chmod fails (might not be on Linux/Mac)
            }
        }
        
        if (testFilePaths.length > 0) {
            vscode.window.showInformationMessage(
                `Test files are now read-only to prevent accidental modifications.`
            );
        }
    }

    private getTestDirectory(): string | null {
        const activeEditor = vscode.window.activeTextEditor;
        let testDirectory = '';

        if (activeEditor) {
            testDirectory = vscode.workspace.getWorkspaceFolder(
                activeEditor.document.uri
            )?.uri.fsPath || '';
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            testDirectory = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }

        return testDirectory || null;
    }

    public async runTests() {
        if (!this._view) {
            vscode.window.showErrorMessage('Test view not initialized');
            return;
        }

        const testDirectory = this.getTestDirectory();
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

            // Send execution record to Revature API
            const apiClient = getApiClient();
            const testMessage = `Tests run: ${results.totalTests}, Passed: ${results.passedTests}, Failed: ${results.failedTests}, Errored: 0, Skipped: ${results.skippedTests}`;
            
            // Send execution record asynchronously (don't block on this)
            apiClient.sendExecutionRecord(
                testDirectory,
                testMessage,
                results.passedTests,
                results.totalTests,
                results.failedTests,
                0, // erroredCount - we don't track this separately yet
                results.skippedTests
            ).catch(error => {
                console.error('Failed to send execution record to API:', error);
            });

            // Commit and push to git (if it's a git repository)
            isGitRepository(testDirectory).then(isGit => {
                if (isGit) {
                    commitAndPushTestResults(
                        testDirectory,
                        results.totalTests,
                        results.passedTests,
                        results.failedTests,
                        results.skippedTests
                    ).catch(error => {
                        console.error('Git commit/push failed:', error);
                    });
                } else {
                    // Show warning if not a git repository
                    vscode.window.showWarningMessage(
                        'Cloud IDE Test: Workspace is not a git repository. Test results will not be committed.'
                    );
                }
            }).catch(error => {
                console.error('Failed to check git status:', error);
            });

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
            .replace('__WORKSPACE_TYPE__', this.workspaceTypeDisplay);
        
        return html;
    }
}

