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
    private readOnlyTestFiles: Set<string> = new Set();
    private originalTestContent: Map<string, string> = new Map();

    constructor(
        private readonly _extensionUri: vscode.Uri, 
        configWarnings: string[] = [],
        context?: vscode.ExtensionContext
    ) {
        // Get configuration (already validated at extension startup)
        const config = getConfig();
        this.workspaceType = config.workspaceType;
        this.workspaceTypeDisplay = config.workspaceType;
        this.configWarnings = configWarnings;
        
        // Initialize the appropriate test adapter
        this.testAdapter = this.getTestAdapter(config.workspaceType);
        
        // Setup read-only protection for test files
        if (context) {
            this.setupReadOnlyProtection(context);
        }
    }

    /**
     * Discover tests during extension activation (before webview is created)
     */
    public async discoverTestsOnActivation() {
        const testDirectory = this.getTestDirectory();
        if (!testDirectory) {
            console.log('No test directory found for test discovery');
            return;
        }

        console.log(`[Test Discovery] Using workspace directory: ${testDirectory}`);

        try {
            const discoveredTests = await this.testAdapter.discoverTests(testDirectory);
            console.log(`[Test Discovery] Discovered ${discoveredTests.length} tests at extension activation`);
            
            // Log the test file paths
            discoveredTests.forEach(test => {
                console.log(`[Test Discovery] Test: ${test.name}, File: ${test.filePath}`);
            });
            
            // Make test files read-only
            await this.makeTestFilesReadOnly(discoveredTests.map(t => t.filePath));
        } catch (error) {
            console.error('Failed to discover tests on activation:', error);
        }
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

        // Display already-discovered tests when webview loads
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
        const workspaceRoot = this.getTestDirectory();
        if (!workspaceRoot) {
            console.warn('Cannot make test files read-only: No workspace root found');
            return;
        }

        console.log(`[chmod] Workspace root: ${workspaceRoot}`);
        
        for (const filePath of testFilePaths) {
            // Convert to absolute path - resolve relative to workspace root
            const absolutePath = path.isAbsolute(filePath) 
                ? filePath 
                : path.join(workspaceRoot, filePath);
            
            console.log(`[chmod] Processing file: ${filePath} -> ${absolutePath}`);
            
            // Track this as a read-only file (using absolute path)
            this.readOnlyTestFiles.add(absolutePath);
            
            // Store original content
            try {
                const content = fs.readFileSync(absolutePath, 'utf8');
                this.originalTestContent.set(absolutePath, content);
                console.log(`Stored original content for: ${absolutePath}`);
            } catch (error) {
                console.warn(`Failed to read test file content: ${absolutePath}`, error);
            }
            
            try {
                // Set read-only at OS level (Linux/Mac) - use absolute path
                const chmodResult = await execAsync(`sudo chmod 444 "${absolutePath}"`);
                console.log(`chmod output: ${chmodResult.stdout || '(no output)'}`);
                
                // Verify the permissions were set
                const lsResult = await execAsync(`ls -l "${absolutePath}"`);
                console.log(`File permissions after chmod: ${lsResult.stdout}`);
                
                if (!lsResult.stdout.includes('r--r--r--')) {
                    console.error(`WARNING: File permissions not set correctly for ${absolutePath}`);
                    vscode.window.showWarningMessage(
                        `Failed to set test file as read-only: ${path.basename(absolutePath)}`
                    );
                } else {
                    console.log(`✓ Successfully set read-only permissions for: ${path.basename(absolutePath)}`);
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`Failed to chmod test file: ${absolutePath}`, errorMsg);
                vscode.window.showWarningMessage(
                    `Failed to protect test file: ${path.basename(absolutePath)} - ${errorMsg}`
                );
            }
        }
    }

    private setupReadOnlyProtection(context: vscode.ExtensionContext): void {
        // Intercept text edits and reject them
        const editDisposable = vscode.workspace.onWillSaveTextDocument((event) => {
            const filePath = event.document.uri.fsPath;
            if (this.readOnlyTestFiles.has(filePath)) {
                vscode.window.showErrorMessage(
                    `Cannot save test file "${path.basename(filePath)}" - it is read-only.`
                );
                // Cancel the save operation
                event.waitUntil(Promise.resolve(false as any));
            }
        });

        // Track when a readonly file is opened and immediately close the editor, reopen as preview
        const openDisposable = vscode.workspace.onDidOpenTextDocument(async (document) => {
            const filePath = document.uri.fsPath;
            if (this.readOnlyTestFiles.has(filePath)) {
                // Get all visible editors
                const editors = vscode.window.visibleTextEditors;
                for (const editor of editors) {
                    if (editor.document.uri.fsPath === filePath) {
                        // Mark editor viewColumn for reopening
                        const viewColumn = editor.viewColumn;
                        
                        // Close the editable version
                        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                        
                        // Reopen in preview mode (readonly)
                        await vscode.commands.executeCommand('vscode.open', document.uri, {
                            preview: true,
                            viewColumn: viewColumn
                        });
                        
                        vscode.window.showWarningMessage(
                            `Test file "${path.basename(filePath)}" opened in read-only mode.`
                        );
                        break;
                    }
                }
            }
        });
        
        context.subscriptions.push(editDisposable, openDisposable);
    }

    private getTestDirectory(): string | null {
        // Always use the first workspace folder as the test directory
        // This ensures we get the user's actual workspace, not any internal IDE files
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }

        return null;
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

