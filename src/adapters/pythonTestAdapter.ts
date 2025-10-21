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
            // Try multiple directory structures to find where tests are located
            // 1. src/ directory (Maven-like structure: src/main/, src/test/)
            // 2. Root with PYTHONPATH=src (alternative: main/ and test/ at root, imports from src/)
            // 3. Root directory (flat structure: test/ at root)
            // Note: Each attempt is wrapped in a subshell with stderr redirected for cd failures
            const srcPath = path.join(directory, 'src');
            
            const command = `
                (cd "${srcPath}" && python3 -m unittest discover -s ./test -p "*test*.py" -v) 2>/dev/null || \
                (cd "${directory}" && PYTHONPATH="${srcPath}:${directory}" python3 -m unittest discover -s ./test -p "*test*.py" -v) 2>/dev/null || \
                (cd "${directory}" && python3 -m unittest discover -s ./test -p "*test*.py" -v) || \
                (cd "${srcPath}" && python3 -m pytest ./test --verbose --junit-xml=../test-results.xml) 2>/dev/null || \
                (cd "${directory}" && python3 -m pytest ./test --verbose --junit-xml=test-results.xml)
            `.replace(/\n/g, ' ').trim();
            
            const result = await execAsync(command, {
                cwd: directory,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                shell: '/bin/bash' // Use bash to support cd and || chaining
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
                console.error('[Python Adapter] Test command failed with no output:');
                console.error('Error:', error.message);
                console.error('Tried multiple directory structures:');
                console.error('  1. cd src && python3 -m unittest discover -s ./test -p "*test*.py" -v');
                console.error('  2. PYTHONPATH=src python3 -m unittest discover -s ./test -p "*test*.py" -v (from root)');
                console.error('  3. python3 -m unittest discover -s ./test -p "*test*.py" -v (from root)');
                console.error('Working directory:', directory);
                throw new Error(`Failed to run tests: ${error.message}`);
            }
        }
        
        // Always parse the output, whether tests passed or failed
        const result = this.parseTestOutput(stdout, stderr, directory);
        
        // Validate: if we discovered tests but got no results, show them as errors with full output
        if (this.discoveredTests.length > 0 && result.tests.length === 0) {
            const errorMessage = `Test execution failed: Discovered ${this.discoveredTests.length} tests but got no results.\n` +
                `This may indicate a Python environment issue or missing test dependencies.\n\n` +
                `=== Full Test Output ===\n${stdout}\n${stderr}`;
            
            console.error('[Python Adapter] Test execution error - Full output:');
            console.error('=== STDOUT ===');
            console.error(stdout || '(empty)');
            console.error('=== STDERR ===');
            console.error(stderr || '(empty)');
            console.error('=== END OUTPUT ===');
            
            // Return discovered tests with error status and full output
            return {
                tests: this.discoveredTests.map(test => ({
                    name: test.name,
                    status: 'error' as const,
                    message: errorMessage
                })),
                totalTests: this.discoveredTests.length,
                passedTests: 0,
                failedTests: 0,
                skippedTests: 0
            };
        }
        
        return result;
    }

    private parseTestOutput(stdout: string, stderr: string, directory: string): TestResult {
        let tests: TestCase[] = [];
        
        // Try to parse pytest XML report if available
        // Check multiple possible locations based on where pytest was run from
        const possibleXmlPaths = [
            path.join(directory, 'test-results.xml'),           // Root directory
            path.join(directory, 'src', 'test-results.xml'),    // src directory (if run from src/)
        ];
        
        for (const xmlPath of possibleXmlPaths) {
            console.log(`[Python Adapter] Checking for XML at: ${xmlPath}`);
            if (fs.existsSync(xmlPath)) {
                console.log(`[Python Adapter] Found XML file at: ${xmlPath}`);
                const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
                const parsedTests = this.parseJUnitXML(xmlContent);
                console.log(`[Python Adapter] Parsed ${parsedTests.length} tests from XML`);
                tests.push(...parsedTests);
                // Clean up the XML file
                try {
                    fs.unlinkSync(xmlPath);
                } catch (e) {
                    // Ignore cleanup errors
                }
                break; // Found and parsed XML, stop looking
            }
        }
        
        if (tests.length === 0) {
            console.log('[Python Adapter] No XML found or XML contained no tests, falling back to console parsing');
        }

        // Fallback: parse from console output
        if (tests.length === 0) {
            // Try pytest format first
            tests = this.parsePytestConsoleOutput(stdout, stderr);
            console.log(`[Python Adapter] Pytest console parsing found ${tests.length} tests`);
            
            // If no pytest results, try unittest format
            if (tests.length === 0) {
                tests = this.parseUnittestConsoleOutput(stdout, stderr);
                console.log(`[Python Adapter] Unittest console parsing found ${tests.length} tests`);
            }
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
                    
                    // Include the full traceback in the message for better debugging
                    message = fullMessage || message;
                    
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
                    const errorMessage = this.decodeXmlEntities(errorMatch[1]);
                    const fullErrorMessage = this.decodeXmlEntities(errorMatch[2]);
                    message = fullErrorMessage || errorMessage;
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

    private parsePytestConsoleOutput(stdout: string, stderr: string): TestCase[] {
        const tests: TestCase[] = [];
        const output = stdout + '\n' + stderr;
        
        // Parse pytest output format:
        // PASSED test/lab_test.py::TestClass::test_method
        // FAILED test/lab_test.py::TestClass::test_method - ErrorType: message
        const testResultPattern = /(PASSED|FAILED|SKIPPED|ERROR)\s+([^\s]+)::([\w]+)::([\w]+)(?:\s+-\s+(.+))?/g;
        
        let match;
        while ((match = testResultPattern.exec(output)) !== null) {
            const [, result, filePath, className, methodName, errorInfo] = match;
            const fullName = `${className}.${methodName}`;
            
            let status: 'passed' | 'failed' | 'skipped' = 'passed';
            let message = '';
            let expected = '';
            let actual = '';
            
            if (result === 'PASSED') {
                status = 'passed';
            } else if (result === 'SKIPPED') {
                status = 'skipped';
                message = errorInfo || '';
            } else {
                status = 'failed';
                
                // Try to find the failure details in the FAILURES section
                const failurePattern = new RegExp(
                    `_{10,}\\s+${className}\\.${methodName}\\s+_{10,}[\\s\\S]*?(?=_{10,}|={10,}|$)`,
                    'i'
                );
                const failureMatch = failurePattern.exec(output);
                
                if (failureMatch) {
                    const failureSection = failureMatch[0];
                    
                    // Check for AssertionError (clean format with expected/actual)
                    const assertionMatch = /self\.assertEqual\(([^,]+),\s*([^)]+)\)/i.exec(failureSection);
                    if (assertionMatch) {
                        // This is an assertion - extract expected and actual
                        actual = assertionMatch[1].trim();
                        expected = assertionMatch[2].trim();
                        message = `Expected ${expected}, but got ${actual}`;
                    } else {
                        // Not an assertion - extract full context
                        // Look for the final error line: "E   ErrorType: message"
                        const errorLineMatch = /E\s+(\w+Error):\s*(.+?)$/m.exec(failureSection);
                        
                        // Look for the file and line number where the error occurred in the source code
                        // Format: "main/lab.py:30: NameError"
                        const sourceLocationMatch = /([^\s]+\.py):(\d+):\s*$/m.exec(failureSection);
                        
                        // Look for the failing line of code
                        // Format: ">       return count" with optional "^^^^^" pointer
                        const failingCodeMatch = />\s+(.+?)(?:\n\s+\^+)?(?:\nE\s+)/m.exec(failureSection);
                        
                        // Look for the function name
                        // Format: "def function_name(param):"
                        const functionMatch = /def\s+(\w+)\s*\([^)]*\):/m.exec(failureSection);
                        
                        // Look for parameter values
                        // Format: "num = 987"
                        const paramMatch = /^(\w+)\s*=\s*(.+?)$/m.exec(failureSection);
                        
                        // Look for the test file location and assertion
                        // Format: "test/lab_test.py:11:" followed by the assertion line
                        const testLocationMatch = /(test[^\s]*\.py):(\d+):/m.exec(failureSection);
                        const testAssertionMatch = />\s+(self\.\w+\([^)]+\))/m.exec(failureSection);
                        
                        if (errorLineMatch) {
                            const errorType = errorLineMatch[1];
                            const errorMsg = errorLineMatch[2].trim();
                            
                            let messageParts = [`${errorType}: ${errorMsg}`];
                            
                            // Add source location with function context
                            if (sourceLocationMatch) {
                                const file = sourceLocationMatch[1];
                                const line = sourceLocationMatch[2];
                                const funcName = functionMatch ? functionMatch[1] : '';
                                const params = paramMatch ? `${paramMatch[1]}=${paramMatch[2]}` : '';
                                
                                if (funcName && params) {
                                    messageParts.push(`  at ${file}:${line} in ${funcName}(${params})`);
                                } else if (funcName) {
                                    messageParts.push(`  at ${file}:${line} in ${funcName}()`);
                                } else {
                                    messageParts.push(`  at ${file}:${line}`);
                                }
                            }
                            
                            // Add the failing line of code
                            if (failingCodeMatch) {
                                const failingCode = failingCodeMatch[1].trim();
                                messageParts.push(`  → ${failingCode}`);
                            }
                            
                            // Add test location and assertion
                            if (testLocationMatch) {
                                const testFile = testLocationMatch[1];
                                const testLine = testLocationMatch[2];
                                messageParts.push(`  Called from: ${testFile}:${testLine}`);
                                
                                if (testAssertionMatch) {
                                    const assertion = testAssertionMatch[1].trim();
                                    messageParts.push(`  → ${assertion}`);
                                }
                            }
                            
                            message = messageParts.join('\n');
                        } else {
                            // Fallback to the short error info from the summary line
                            message = errorInfo || 'Test failed';
                        }
                    }
                } else {
                    // No detailed failure section found, use summary line
                    message = errorInfo || 'Test failed';
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

