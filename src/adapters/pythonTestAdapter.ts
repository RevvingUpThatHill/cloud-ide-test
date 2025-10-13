import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { TestAdapter, TestResult, TestCase } from './testAdapter';

const execAsync = promisify(exec);

export class PythonTestAdapter implements TestAdapter {
    async runTests(directory: string): Promise<TestResult> {
        try {
            // Run Python unittest with verbose output and XML reporting
            const command = 'python -m pytest --verbose --junit-xml=test-results.xml || python -m unittest discover -v';
            const { stdout, stderr } = await execAsync(command, {
                cwd: directory,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });

            // Parse the test results
            return this.parseTestOutput(stdout, stderr, directory);
        } catch (error: any) {
            // Even if tests fail, output might contain results
            if (error.stdout) {
                return this.parseTestOutput(error.stdout, error.stderr || '', directory);
            }
            throw error;
        }
    }

    private parseTestOutput(stdout: string, stderr: string, directory: string): TestResult {
        const tests: TestCase[] = [];
        
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
            tests.push(...this.parseUnittestConsoleOutput(stdout, stderr));
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
        // Pattern: test_method_name (test.module.TestClass) ... ok/FAIL/ERROR/skipped
        const testPattern = /^(test_\w+)\s+\(([^)]+)\)\s+\.\.\.\s+(ok|FAIL|ERROR|skipped)/gm;
        
        let match;
        while ((match = testPattern.exec(output)) !== null) {
            const [, methodName, className, result] = match;
            const fullName = `${className}.${methodName}`;
            
            let status: 'passed' | 'failed' | 'skipped' = 'passed';
            let message = '';
            
            if (result === 'ok') {
                status = 'passed';
            } else if (result === 'skipped') {
                status = 'skipped';
            } else {
                status = 'failed';
                // Try to find the error message for this test
                const failPattern = new RegExp(`${methodName}[\\s\\S]*?(?:AssertionError|Error):\\s*([^\\n]+)`, 'i');
                const failMatch = failPattern.exec(output);
                if (failMatch) {
                    message = failMatch[1].trim();
                }
            }
            
            tests.push({
                name: fullName,
                status,
                message: message || undefined
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

