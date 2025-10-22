import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { TestAdapter, TestResult, TestCase, DiscoveredTest } from './testAdapter';

const execAsync = promisify(exec);

export class AngularTestAdapter implements TestAdapter {
    private discoveredTests: DiscoveredTest[] = [];

    async discoverTests(directory: string): Promise<DiscoveredTest[]> {
        const tests: DiscoveredTest[] = [];
        const srcDir = path.join(directory, 'src');

        if (!fs.existsSync(srcDir)) {
            return tests;
        }

        // Recursively find all .spec.ts files
        const findSpecFiles = (dir: string): string[] => {
            const files: string[] = [];
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory() && entry.name !== 'node_modules') {
                        files.push(...findSpecFiles(fullPath));
                    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
                        files.push(fullPath);
                    }
                }
            } catch (error) {
                // Ignore permission errors
            }
            return files;
        };

        const specFiles = findSpecFiles(srcDir);

        // Parse each spec file to discover test cases
        for (const filePath of specFiles) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                
                // Find describe blocks and it/test blocks
                const itMatches = content.matchAll(/(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g);
                for (const match of itMatches) {
                    const testName = match[1];
                    tests.push({
                        name: testName,
                        filePath: path.relative(directory, filePath)
                    });
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }

        // Store discovered tests for validation during test execution
        this.discoveredTests = tests;
        return tests;
    }

    async runTests(directory: string): Promise<TestResult> {
        // Check if angular.json or package.json exists
        const angularJsonPath = path.join(directory, 'angular.json');
        const packageJsonPath = path.join(directory, 'package.json');
        
        const hasAngularJson = fs.existsSync(angularJsonPath);
        const hasPackageJson = fs.existsSync(packageJsonPath);

        if (!hasAngularJson && !hasPackageJson) {
            throw new Error('No angular.json or package.json found. This doesn\'t appear to be an Angular project.');
        }

        let stdout = '';
        let stderr = '';
        
        try {
            // Run Karma tests in single-run mode
            // Add CHROME_BIN for EC2/Docker environments
            const env = { 
                ...process.env, 
                CI: 'true', // Force CI mode for single run
                CHROME_BIN: process.env.CHROME_BIN || '/snap/bin/chromium' // Fallback to snap chromium
            };
            
            let command = 'npm run test -- --watch=false --browsers=ChromeHeadless';
            let karmaConfigPath: string | null = null;
            
            // Check if running as root (common in EC2/Docker)
            const isRoot = process.getuid && process.getuid() === 0;
            if (isRoot) {
                // When running as root, create a temporary karma config with --no-sandbox
                karmaConfigPath = path.join(directory, 'karma-nosandbox.conf.js');
                const karmaConfig = `
// Temporary karma config for running tests as root (EC2/Docker)
module.exports = function(config) {
  // Load the original karma config if it exists
  let originalConfig = {};
  try {
    const originalConfigPath = require.resolve('./karma.conf.js');
    const originalConfigFn = require(originalConfigPath);
    originalConfigFn({ set: (cfg) => { originalConfig = cfg; } });
  } catch (e) {
    // No original config, use defaults
  }

  config.set({
    ...originalConfig,
    customLaunchers: {
      ...originalConfig.customLaunchers,
      ChromeHeadless: {
        base: 'Chrome',
        flags: [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--remote-debugging-port=9222'
        ]
      }
    },
    singleRun: true
  });
};
`;
                fs.writeFileSync(karmaConfigPath, karmaConfig, 'utf8');
                command = `npm run test -- --karma-config=karma-nosandbox.conf.js --watch=false --browsers=ChromeHeadless`;
            }
            
            const result = await execAsync(command, {
                cwd: directory,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                env: env
            });
            
            stdout = result.stdout;
            stderr = result.stderr;
            
            // Clean up temporary karma config
            if (karmaConfigPath && fs.existsSync(karmaConfigPath)) {
                fs.unlinkSync(karmaConfigPath);
            }
        } catch (error: any) {
            // Command failed (non-zero exit code) - this is NORMAL when tests fail
            stdout = error.stdout || '';
            stderr = error.stderr || '';
            
            // Clean up temporary karma config even on error
            const karmaConfigPath = path.join(directory, 'karma-nosandbox.conf.js');
            if (fs.existsSync(karmaConfigPath)) {
                try {
                    fs.unlinkSync(karmaConfigPath);
                } catch (cleanupError) {
                    // Ignore cleanup errors
                }
            }
            
            if (!stdout && !stderr) {
                console.error('[Angular Adapter] Test command failed with no output:');
                console.error('Error:', error.message);
                console.error('Command:', 'npm run test -- --watch=false --browsers=ChromeHeadless');
                console.error('Working directory:', directory);
                throw new Error(`Failed to run Angular tests: ${error.message}`);
            }
        }

        // Always parse the output, whether tests passed or failed
        const result = this.parseTestOutput(stdout, stderr, directory);
        
        // Clean ANSI escape codes from output for display
        const cleanStdout = stdout.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
        const cleanStderr = stderr.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
        
        // Add full output to each test for detail panel
        const fullOutput = `=== STDOUT ===\n${cleanStdout}\n\n=== STDERR ===\n${cleanStderr}`;
        result.tests = result.tests.map(test => ({
            ...test,
            fullOutput: test.fullOutput ? test.fullOutput.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '') : fullOutput
        }));
        
        // Add the command to the result
        result.command = 'npm run test -- --watch=false --browsers=ChromeHeadless';
        
        // Validate: if we discovered tests but got no results, show them as errors
        if (this.discoveredTests.length > 0 && result.tests.length === 0) {
            const errorMessage = `Test execution failed: Discovered ${this.discoveredTests.length} tests but got no results. ` +
                `This may indicate an Angular/Karma configuration issue or missing dependencies.`;
            
            console.error('[Angular Adapter] Test execution error - Full output:');
            console.error('=== STDOUT ===');
            console.error(stdout || '(empty)');
            console.error('=== STDERR ===');
            console.error(stderr || '(empty)');
            console.error('=== END OUTPUT ===');
            
            // Return discovered tests with error status instead of throwing
            return {
                tests: this.discoveredTests.map(test => ({
                    name: test.name,
                    status: 'error' as const,
                    message: errorMessage,
                    fullOutput: fullOutput
                })),
                totalTests: this.discoveredTests.length,
                passedTests: 0,
                failedTests: 0,
                skippedTests: 0,
                command: 'npm run test -- --watch=false --browsers=ChromeHeadless'
            };
        }
        
        return result;
    }

    private parseTestOutput(stdout: string, stderr: string, directory: string): TestResult {
        let tests: TestCase[] = [];
        
        // Try to parse Karma JUnit XML reports if configured
        const resultsDir = path.join(directory, 'test-results');
        if (fs.existsSync(resultsDir)) {
            const xmlFiles = fs.readdirSync(resultsDir)
                .filter(file => file.endsWith('.xml'));
            
            for (const xmlFile of xmlFiles) {
                const xmlPath = path.join(resultsDir, xmlFile);
                const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
                tests.push(...this.parseJUnitXML(xmlContent));
            }
        }

        // Fallback: parse from Karma console output
        if (tests.length === 0) {
            tests = this.parseKarmaConsoleOutput(stdout);
        }

        // Filter to only include tests that were discovered
        // This prevents phantom "Failed Test 1" entries from appearing
        const discoveredTestNames = new Set(this.discoveredTests.map(t => t.name));
        tests = tests.filter(test => discoveredTestNames.has(test.name));

        // Add any discovered tests that weren't in the parsed results as "passed"
        // Karma typically only outputs failed tests explicitly
        const parsedTestNames = new Set(tests.map(t => t.name));
        
        for (const discoveredTest of this.discoveredTests) {
            if (!parsedTestNames.has(discoveredTest.name)) {
                // This test was discovered but not in the output, assume it passed
                console.log(`[Angular Adapter] Test ${discoveredTest.name} not in output, inferring passed status`);
                tests.push({
                    name: discoveredTest.name,
                    status: 'passed'
                });
            }
        }

        const passedTests = tests.filter(t => t.status === 'passed').length;
        const failedTests = tests.filter(t => t.status === 'failed').length;
        const skippedTests = tests.filter(t => t.status === 'skipped').length;

        return {
            tests,
            totalTests: tests.length,
            passedTests,
            failedTests,
            skippedTests
        };
    }

    private parseJUnitXML(xmlContent: string): TestCase[] {
        const tests: TestCase[] = [];
        
        const testCaseRegex = /<testcase[^>]*name="([^"]*)"[^>]*classname="([^"]*)"[^>]*time="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g;
        
        let match;
        while ((match = testCaseRegex.exec(xmlContent)) !== null) {
            const [, name, className, time, content] = match;
            const fullName = `${className} > ${name}`;
            
            let status: 'passed' | 'failed' | 'skipped' = 'passed';
            let message = '';
            let expected = '';
            let actual = '';
            
            if (content.includes('<failure')) {
                status = 'failed';
                const failureMatch = /<failure[^>]*>([\s\S]*?)<\/failure>/.exec(content);
                if (failureMatch) {
                    const fullMessage = this.decodeXmlEntities(failureMatch[1]);
                    
                    // Determine if this is an assertion failure or other error
                    const isAssertionError = /Expected|toBe|toEqual|toMatch|toContain/i.test(fullMessage);
                    
                    if (isAssertionError) {
                        // Clean assertion failure - extract expected/actual
                        const result = this.parseJasmineAssertion(fullMessage);
                        message = result.message;
                        expected = result.expected;
                        actual = result.actual;
                    } else {
                        // Non-assertion error - provide full context
                        message = this.parseJasmineError(fullMessage);
                    }
                }
            } else if (content.includes('<error')) {
                status = 'failed';
                const errorMatch = /<error[^>]*>([\s\S]*?)<\/error>/.exec(content);
                if (errorMatch) {
                    const fullMessage = this.decodeXmlEntities(errorMatch[1]);
                    // Errors are always non-assertion
                    message = this.parseJasmineError(fullMessage);
                }
            } else if (content.includes('<skipped')) {
                status = 'skipped';
            }
            
            tests.push({
                name: fullName,
                status,
                duration: Math.round(parseFloat(time) * 1000),
                message: message || undefined,
                expected: expected || undefined,
                actual: actual || undefined
            });
        }
        
        return tests;
    }

    private parseKarmaConsoleOutput(output: string): TestCase[] {
        const tests: TestCase[] = [];
        
        // Remove ANSI escape codes that interfere with parsing
        const cleanOutput = output.replace(/\x1B\[\d+[A-Z]/g, '');
        
        console.log('[Angular Adapter] Parsing Karma output for failed tests...');
        
        // Parse failed tests from Karma console output
        // Pattern: "Chrome Headless ... ComponentName testName FAILED"
        const failedTestPattern = /(?:Chrome|PhantomJS|Firefox)[^\n]*?\s+([A-Z]\w+(?:\s+\w+)*)\s+(should\s+[^\n]+?)\s+FAILED/g;
        
        let match;
        while ((match = failedTestPattern.exec(cleanOutput)) !== null) {
            const [fullMatch, componentName, testDescription] = match;
            
            console.log(`[Angular Adapter] Found failed test: ${componentName} > ${testDescription}`);
            
            let message = '';
            let fullOutput = '';
            
            // Extract the error details that follow this test
            const errorStartIndex = match.index + fullMatch.length;
            const nextTestMatch = /(?:Chrome|PhantomJS|Firefox)[^\n]*?\s+(?:Executed|[A-Z]\w+)/.exec(cleanOutput.substring(errorStartIndex));
            const errorEndIndex = nextTestMatch ? errorStartIndex + nextTestMatch.index : cleanOutput.length;
            const errorSection = cleanOutput.substring(errorStartIndex, errorEndIndex).trim();
            
            // Extract error message
            const errorMatch = /Error:\s*(.+?)(?:\n|$)/.exec(errorSection);
            if (errorMatch) {
                message = errorMatch[1].trim();
                fullOutput = errorSection;
            } else {
                message = 'Test failed';
                fullOutput = errorSection;
            }
            
            // Use just the test description (not component name) to match discovered tests
            tests.push({
                name: testDescription,
                status: 'failed',
                message: message || undefined,
                fullOutput: fullOutput || undefined
            });
        }
        
        console.log(`[Angular Adapter] Parsed ${tests.length} failed tests from console output`);
        
        return tests;
    }

    private parseJasmineAssertion(fullMessage: string): { message: string; expected: string; actual: string } {
        let message = '';
        let expected = '';
        let actual = '';
        
        // Jasmine pattern 1: "Expected <actual> to be <expected>"
        const pattern1 = /Expected\s+(.+?)\s+to\s+(?:be|equal)\s+(.+?)(?:\.|$)/i.exec(fullMessage);
        if (pattern1) {
            actual = pattern1[1].trim();
            expected = pattern1[2].trim();
            message = 'Values not equal';
            return { message, expected, actual };
        }
        
        // Jasmine pattern 2: "Expected <actual> not to be <expected>"
        const pattern2 = /Expected\s+(.+?)\s+not\s+to\s+(?:be|equal)\s+(.+?)(?:\.|$)/i.exec(fullMessage);
        if (pattern2) {
            actual = pattern2[1].trim();
            expected = `not ${pattern2[2].trim()}`;
            message = 'Values should not be equal';
            return { message, expected, actual };
        }
        
        // Jasmine pattern 3: "Expected <actual> to contain <expected>"
        const pattern3 = /Expected\s+(.+?)\s+to\s+contain\s+(.+?)(?:\.|$)/i.exec(fullMessage);
        if (pattern3) {
            actual = pattern3[1].trim();
            expected = `to contain ${pattern3[2].trim()}`;
            message = 'Expected value to contain';
            return { message, expected, actual };
        }
        
        // Jasmine pattern 4: "Expected <actual> to match <expected>"
        const pattern4 = /Expected\s+(.+?)\s+to\s+match\s+(.+?)(?:\.|$)/i.exec(fullMessage);
        if (pattern4) {
            actual = pattern4[1].trim();
            expected = pattern4[2].trim();
            message = 'Expected value to match pattern';
            return { message, expected, actual };
        }
        
        // Generic pattern: "expected: <value>, actual: <value>"
        const pattern5 = /expected:?\s*(.+?)(?:,|\n).*?actual:?\s*(.+?)(?:\.|$)/i.exec(fullMessage);
        if (pattern5) {
            expected = pattern5[1].trim();
            actual = pattern5[2].trim();
            message = 'Values not equal';
            return { message, expected, actual };
        }
        
        // Fallback: extract first line as message
        const firstLine = fullMessage.split('\n')[0];
        message = firstLine || 'Assertion failed';
        return { message, expected, actual };
    }
    
    private parseJasmineError(fullMessage: string): string {
        const messageParts: string[] = [];
        const lines = fullMessage.split('\n');
        
        // Extract error type and message from first line
        const firstLine = lines[0] || '';
        const errorTypeMatch = /^([\w]+Error):\s*(.*)$/.exec(firstLine);
        
        if (errorTypeMatch) {
            const errorType = errorTypeMatch[1];
            const errorMsg = errorTypeMatch[2] || firstLine;
            messageParts.push(`${errorType}: ${errorMsg}`);
        } else {
            messageParts.push(firstLine);
        }
        
        // Extract stack trace information
        let foundRelevantStack = false;
        
        for (const line of lines) {
            // Look for "at" lines in the stack trace
            const atMatch = /^\s*at\s+(?:Object\.)?([^\s]+)\s+\(([^:]+):(\d+):(\d+)\)/.exec(line);
            if (atMatch) {
                const method = atMatch[1].trim();
                const file = atMatch[2].trim();
                const lineNum = atMatch[3];
                
                // Skip Angular/Jasmine internal files, focus on user code
                if (!file.includes('node_modules') && 
                    !file.includes('karma') &&
                    !file.includes('jasmine') &&
                    !foundRelevantStack) {
                    
                    // Extract just the filename from path
                    const fileName = file.split('/').pop() || file;
                    
                    if (method && method !== '<anonymous>') {
                        messageParts.push(`  at ${fileName}:${lineNum} in ${method}()`);
                    } else {
                        messageParts.push(`  at ${fileName}:${lineNum}`);
                    }
                    foundRelevantStack = true;
                }
            }
            
            // Look for webpack/source map references
            const webpackMatch = /^\s*at\s+webpack:\/\/\/\.\/([^:]+):(\d+):(\d+)/.exec(line);
            if (webpackMatch && !foundRelevantStack) {
                const file = webpackMatch[1];
                const lineNum = webpackMatch[2];
                messageParts.push(`  at ${file}:${lineNum}`);
                foundRelevantStack = true;
            }
        }
        
        // If no stack trace was found, include first few lines
        if (!foundRelevantStack && lines.length > 1) {
            const additionalLines = lines.slice(1, 4).filter(l => l.trim()).join('\n');
            if (additionalLines.trim()) {
                messageParts.push(`  ${additionalLines.trim()}`);
            }
        }
        
        return messageParts.join('\n');
    }
    
    private decodeXmlEntities(text: string): string {
        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }
}

