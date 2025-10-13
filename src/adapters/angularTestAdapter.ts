import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { TestAdapter, TestResult, TestCase } from './testAdapter';

const execAsync = promisify(exec);

export class AngularTestAdapter implements TestAdapter {
    async runTests(directory: string): Promise<TestResult> {
        try {
            // Check if angular.json or package.json exists
            const angularJsonPath = path.join(directory, 'angular.json');
            const packageJsonPath = path.join(directory, 'package.json');
            
            const hasAngularJson = fs.existsSync(angularJsonPath);
            const hasPackageJson = fs.existsSync(packageJsonPath);

            if (!hasAngularJson && !hasPackageJson) {
                throw new Error('No angular.json or package.json found. This doesn\'t appear to be an Angular project.');
            }

            // Run Karma tests in single-run mode
            const command = 'npm run test -- --watch=false --browsers=ChromeHeadless';
            const { stdout, stderr } = await execAsync(command, {
                cwd: directory,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                env: { ...process.env, CI: 'true' } // Force CI mode for single run
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
            tests.push(...this.parseKarmaConsoleOutput(stdout));
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
                    message = fullMessage;
                    
                    // Try to extract expected and actual values from Jasmine format
                    const expectedMatch = /Expected\s+(.+?)\s+to/i.exec(fullMessage) ||
                                        /expected:?\s*(.+?)(?:\n|$)/i.exec(fullMessage);
                    const actualMatch = /(?:but was|actual):?\s*(.+?)(?:\n|$)/i.exec(fullMessage);
                    
                    if (expectedMatch) {expected = expectedMatch[1].trim();}
                    if (actualMatch) {actual = actualMatch[1].trim();}
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
        const lines = output.split('\n');
        
        // Look for Karma summary line like: "Chrome Headless: Executed 15 of 15 (3 FAILED) (0.234 secs / 0.189 secs)"
        const summaryPattern = /(?:Chrome|PhantomJS|Firefox)[^:]*:\s*Executed\s+(\d+)\s+of\s+(\d+)(?:\s+\((\d+)\s+FAILED\))?/;
        const match = summaryPattern.exec(output);
        
        if (match) {
            const [, executed, total, failed] = match;
            const failedCount = parseInt(failed || '0');
            const passedCount = parseInt(executed) - failedCount;
            
            // Try to find individual test details
            const specPattern = /✓|×|FAILED\s+(.+?)(?:\n|$)/g;
            let specMatch;
            let testIndex = 0;
            
            while ((specMatch = specPattern.exec(output)) !== null) {
                const isPassed = output[specMatch.index] === '✓';
                const testName = specMatch[1] || `Test ${testIndex + 1}`;
                
                tests.push({
                    name: testName.trim(),
                    status: isPassed ? 'passed' : 'failed',
                    message: isPassed ? undefined : 'Check Karma output for details'
                });
                testIndex++;
            }
            
            // If no individual tests found, create generic entries
            if (tests.length === 0) {
                for (let i = 0; i < passedCount; i++) {
                    tests.push({ name: `Test ${i + 1}`, status: 'passed' });
                }
                for (let i = 0; i < failedCount; i++) {
                    tests.push({
                        name: `Failed Test ${i + 1}`,
                        status: 'failed',
                        message: 'Check Karma output for details'
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

