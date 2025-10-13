import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { TestAdapter, TestResult, TestCase } from './testAdapter';

const execAsync = promisify(exec);

export class JavaTestAdapter implements TestAdapter {
    async runTests(directory: string): Promise<TestResult> {
        try {
            // Check if pom.xml exists (Maven project)
            const pomPath = path.join(directory, 'pom.xml');
            const hasPom = fs.existsSync(pomPath);

            if (!hasPom) {
                throw new Error('No pom.xml found. This doesn\'t appear to be a Maven project.');
            }

            // Run Maven tests
            const command = 'mvn test';
            const { stdout, stderr } = await execAsync(command, {
                cwd: directory,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });

            // Parse the test results
            return this.parseTestOutput(stdout, stderr, directory);
        } catch (error: any) {
            // Even if tests fail, Maven outputs results, so parse them
            if (error.stdout) {
                return this.parseTestOutput(error.stdout, error.stderr || '', directory);
            }
            throw error;
        }
    }

    private parseTestOutput(stdout: string, stderr: string, directory: string): TestResult {
        const tests: TestCase[] = [];
        
        // Try to parse JUnit XML reports if available
        const surefireReportsDir = path.join(directory, 'target', 'surefire-reports');
        if (fs.existsSync(surefireReportsDir)) {
            const xmlFiles = fs.readdirSync(surefireReportsDir)
                .filter(file => file.startsWith('TEST-') && file.endsWith('.xml'));
            
            for (const xmlFile of xmlFiles) {
                const xmlPath = path.join(surefireReportsDir, xmlFile);
                const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
                tests.push(...this.parseJUnitXML(xmlContent));
            }
        }

        // Fallback: parse from stdout
        if (tests.length === 0) {
            tests.push(...this.parseConsoleOutput(stdout));
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
        
        // Simple regex-based XML parsing (for production, consider using xml2js)
        const testCaseRegex = /<testcase[^>]*name="([^"]*)"[^>]*classname="([^"]*)"[^>]*time="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g;
        
        let match;
        while ((match = testCaseRegex.exec(xmlContent)) !== null) {
            const [, name, className, time, content] = match;
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
                    
                    // Try to extract expected and actual values
                    const expectedMatch = /expected:?\s*<?([^>]+)>?/i.exec(fullMessage);
                    const actualMatch = /but was:?\s*<?([^>]+)>?/i.exec(fullMessage);
                    
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

    private parseConsoleOutput(output: string): TestCase[] {
        const tests: TestCase[] = [];
        const lines = output.split('\n');
        
        // Look for Maven Surefire output patterns
        const testPattern = /Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/;
        const match = testPattern.exec(output);
        
        if (match) {
            const [, total, failures, errors, skipped] = match;
            const passed = parseInt(total) - parseInt(failures) - parseInt(errors) - parseInt(skipped);
            
            // Create generic test entries
            for (let i = 0; i < passed; i++) {
                tests.push({ name: `Test ${i + 1}`, status: 'passed' });
            }
            for (let i = 0; i < parseInt(failures) + parseInt(errors); i++) {
                tests.push({
                    name: `Failed Test ${i + 1}`,
                    status: 'failed',
                    message: 'Check Maven output for details'
                });
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

