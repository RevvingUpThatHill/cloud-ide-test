import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { TestAdapter, TestResult, TestCase, DiscoveredTest } from './testAdapter';

const execAsync = promisify(exec);

export class PythonTestAdapter implements TestAdapter {
    private discoveredTests: DiscoveredTest[] = [];

    async discoverTests(directory: string): Promise<DiscoveredTest[]> {
        const tests: DiscoveredTest[] = [];
        const testDir = path.join(directory, 'src', 'test');

        if (!fs.existsSync(testDir)) {
            return tests;
        }

        // Recursively find all test files
        const findTestFiles = (dir: string): string[] => {
            const files: string[] = [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    files.push(...findTestFiles(fullPath));
                } else if (entry.isFile() && entry.name.includes('test') && entry.name.endsWith('.py')) {
                    files.push(fullPath);
                }
            }
            return files;
        };

        const testFiles = findTestFiles(testDir);

        // Parse each test file to discover test methods
        for (const filePath of testFiles) {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            
            let currentClass = '';
            for (const line of lines) {
                // Find test classes
                const classMatch = /^class\s+(\w+)/.exec(line);
                if (classMatch) {
                    currentClass = classMatch[1];
                }
                
                // Find test methods
                const methodMatch = /^\s+def\s+(test\w+)\s*\(/.exec(line);
                if (methodMatch && currentClass) {
                    const testName = `${currentClass}.${methodMatch[1]}`;
                    tests.push({
                        name: testName,
                        filePath: path.relative(directory, filePath)
                    });
                }
            }
        }

        // Store discovered tests for validation during test execution
        this.discoveredTests = tests;
        return tests;
    }

    async runTests(directory: string): Promise<TestResult> {
        let stdout = '';
        let stderr = '';
        
        try {
            // Run Python unittest first (built-in), fall back to pytest if available
            // Discovery starts in src/test folder and matches any .py file containing "test"
            const command = 'python3 -m unittest discover -s src/test -p "*test*.py" -v || python3 -m pytest src/test --verbose --junit-xml=test-results.xml';
            const result = await execAsync(command, {
                cwd: directory,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });
            stdout = result.stdout;
            stderr = result.stderr;
        } catch (error: any) {
            // Command failed (non-zero exit code) - this is NORMAL when tests fail
            // Capture the output anyway
            stdout = error.stdout || '';
            stderr = error.stderr || '';
            
            // Only throw if there's truly no output (command not found, etc.)
            if (!stdout && !stderr) {
                throw new Error(`Failed to run tests: ${error.message}`);
            }
        }
        
        // Always parse the output, whether tests passed or failed
        const result = this.parseTestOutput(stdout, stderr, directory);
        
        // Validate: if we discovered tests but got no results, it's a real error
        if (this.discoveredTests.length > 0 && result.tests.length === 0) {
            throw new Error(
                `Test execution failed: Discovered ${this.discoveredTests.length} tests but got no results. ` +
                `This may indicate a Python environment issue or missing test dependencies.`
            );
        }
        
        return result;
    }

    private parseTestOutput(stdout: string, stderr: string, directory: string): TestResult {
        let tests: TestCase[] = [];
        
        // Try to parse pytest XML report if available
        const xmlPath = path.join(directory, 'test-results.xml');
        if (fs.existsSync(xmlPath)) {
            const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
            tests.push(...this.parseJUnitXML(xmlContent));
            // Clean up the XML file
            try {
                fs.unlinkSync(xmlPath);
            } catch (e) {
                // Ignore cleanup errors
            }
        }

        // Fallback: parse from unittest console output
        if (tests.length === 0) {
            tests = this.parseUnittestConsoleOutput(stdout, stderr);
        }

        // Filter to only include tests that were discovered
        // This prevents phantom "Failed Test 1" entries from appearing
        const discoveredTestNames = new Set(this.discoveredTests.map(t => t.name));
        tests = tests.filter(test => discoveredTestNames.has(test.name));

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
        
        const testCaseRegex = /<testcase[^>]*classname="([^"]*)"[^>]*name="([^"]*)"[^>]*time="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g;
        
        let match;
        while ((match = testCaseRegex.exec(xmlContent)) !== null) {
            const [, className, name, time, content] = match;
            const fullName = `${className}.${name}`;
            
            let status: 'passed' | 'failed' | 'skipped' = 'passed';
            let message = '';
            let expected = '';
            let actual = '';
            
            if (content.includes('<failure')) {
                status = 'failed';
                const failureMatch = /<failure[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/failure>/.exec(content);
                if (failureMatch) {
                    message = this.decodeXmlEntities(failureMatch[1]);
                    const fullMessage = this.decodeXmlEntities(failureMatch[2]);
                    
                    // Try to extract expected and actual from assertion errors
                    const assertMatch = /AssertionError:\s*(.+)/s.exec(fullMessage);
                    if (assertMatch) {
                        const assertMsg = assertMatch[1];
                        const parts = assertMsg.split('!=');
                        if (parts.length === 2) {
                            expected = parts[0].trim();
                            actual = parts[1].trim();
                        } else {
                            // Try other patterns
                            const expectedMatch = /expected:?\s*(.+?)(?:\n|$)/i.exec(assertMsg);
                            const actualMatch = /(?:but was|actual|got):?\s*(.+?)(?:\n|$)/i.exec(assertMsg);
                            if (expectedMatch) {expected = expectedMatch[1].trim();}
                            if (actualMatch) {actual = actualMatch[1].trim();}
                        }
                    }
                }
            } else if (content.includes('<skipped')) {
                status = 'skipped';
                const skippedMatch = /<skipped[^>]*message="([^"]*)"/.exec(content);
                if (skippedMatch) {
                    message = this.decodeXmlEntities(skippedMatch[1]);
                }
            } else if (content.includes('<error')) {
                status = 'failed';
                const errorMatch = /<error[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/error>/.exec(content);
                if (errorMatch) {
                    message = this.decodeXmlEntities(errorMatch[1]);
                }
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

    private parseUnittestConsoleOutput(stdout: string, stderr: string): TestCase[] {
        const tests: TestCase[] = [];
        const output = stdout + '\n' + stderr;
        const lines = output.split('\n');
        
        // Parse unittest verbose output
        // Pattern: test_method_name (module.ClassName.test_method_name) ... ok/FAIL/ERROR/skipped
        // or: test_method_name (module.ClassName) ... ok/FAIL/ERROR/skipped
        const testPattern = /^(test_\w+)\s+\(([^)]+)\)\s+\.\.\.\s+(ok|FAIL|ERROR|skipped)/gm;
        
        let match;
        while ((match = testPattern.exec(output)) !== null) {
            const [, methodName, fullPath, result] = match;
            
            // Extract class name from full path
            // Format can be: lab_test.TestLabFunctions.test_method or lab_test.TestLabFunctions
            const pathParts = fullPath.split('.');
            let className = '';
            
            // If the last part is the method name (duplicate), remove it
            if (pathParts[pathParts.length - 1] === methodName) {
                className = pathParts[pathParts.length - 2];
            } else {
                className = pathParts[pathParts.length - 1];
            }
            
            const fullName = `${className}.${methodName}`;
            
            let status: 'passed' | 'failed' | 'skipped' = 'passed';
            let message = '';
            let expected = '';
            let actual = '';
            
            if (result === 'ok') {
                status = 'passed';
            } else if (result === 'skipped') {
                status = 'skipped';
            } else {
                status = 'failed';
                // Try to find the error message for this test
                const failPattern = new RegExp(`FAIL: ${methodName}[\\s\\S]*?AssertionError:\\s*([^\\n]+)`, 'i');
                const failMatch = failPattern.exec(output);
                if (failMatch) {
                    message = failMatch[1].trim();
                    
                    // Try to extract expected vs actual from assertion message
                    // Format: "actual != expected" or "actual == expected (for negative assertions)"
                    const comparisonMatch = /^(.+?)\s*!=\s*(.+)$/.exec(message);
                    if (comparisonMatch) {
                        actual = comparisonMatch[1].trim();
                        expected = comparisonMatch[2].trim();
                    }
                }
            }
            
            tests.push({
                name: fullName,
                status,
                message: message || undefined,
                expected: expected || undefined,
                actual: actual || undefined
            });
        }
        
        // If no tests found with pattern, look for summary
        if (tests.length === 0) {
            const summaryPattern = /Ran (\d+) tests?/i;
            const summaryMatch = summaryPattern.exec(output);
            
            if (summaryMatch) {
                const totalTests = parseInt(summaryMatch[1]);
                const failedPattern = /FAILED \((?:failures=(\d+))?(?:,\s*)?(?:errors=(\d+))?\)/i;
                const failedMatch = failedPattern.exec(output);
                
                let failedCount = 0;
                if (failedMatch) {
                    failedCount = (parseInt(failedMatch[1] || '0')) + (parseInt(failedMatch[2] || '0'));
                }
                
                const passedCount = totalTests - failedCount;
                
                // Create generic test entries
                for (let i = 0; i < passedCount; i++) {
                    tests.push({ name: `Test ${i + 1}`, status: 'passed' });
                }
                for (let i = 0; i < failedCount; i++) {
                    tests.push({
                        name: `Failed Test ${i + 1}`,
                        status: 'failed',
                        message: 'Check unittest output for details'
                    });
                }
            }
        }
        
        return tests;
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

