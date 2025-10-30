/**
 * Shared XML parsing utilities for test adapters
 * Used by Java, Angular, and Python adapters to parse JUnit XML reports
 */

/**
 * Decode XML entities in text
 * Converts &lt; &gt; &quot; &apos; &amp; back to their original characters
 */
export function decodeXmlEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * Base interface for parsed test case from JUnit XML
 */
export interface ParsedXmlTestCase {
    name: string;
    className: string;
    time: number; // in milliseconds
    status: 'passed' | 'failed' | 'error' | 'skipped';
    message?: string;
    fullMessage?: string; // Complete error/failure message with stack trace
}

/**
 * Extract test cases from JUnit XML content using regex
 * Returns array of parsed test cases with basic information
 * 
 * Note: This is a base implementation. Each adapter can extend the parsing
 * to extract language-specific details (expected/actual values, etc.)
 */
export function parseJUnitXmlTestCases(xmlContent: string): ParsedXmlTestCase[] {
    const tests: ParsedXmlTestCase[] = [];
    
    // Match testcase elements with all their attributes and content
    // Pattern handles both self-closing and full elements
    const testCaseRegex = /<testcase([^>]*)>([\s\S]*?)<\/testcase>|<testcase([^>]*)\/>/g;
    
    let match;
    while ((match = testCaseRegex.exec(xmlContent)) !== null) {
        // Attributes are either in group 1 (full element) or group 3 (self-closing)
        const attributes = match[1] || match[3] || '';
        const content = match[2] || ''; // Empty for self-closing tags
        
        // Extract attributes
        const nameMatch = /name="([^"]*)"/.exec(attributes);
        const classNameMatch = /classname="([^"]*)"/.exec(attributes);
        const timeMatch = /time="([^"]*)"/.exec(attributes);
        
        if (!nameMatch || !classNameMatch) {
            continue; // Skip malformed test cases
        }
        
        const name = nameMatch[1];
        const className = classNameMatch[1];
        const time = timeMatch ? Math.round(parseFloat(timeMatch[1]) * 1000) : 0;
        
        // Determine status and extract messages
        let status: 'passed' | 'failed' | 'error' | 'skipped' = 'passed';
        let message = '';
        let fullMessage = '';
        
        if (content.includes('<failure')) {
            status = 'failed';
            const failureMatch = /<failure[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/failure>/.exec(content);
            if (failureMatch) {
                message = decodeXmlEntities(failureMatch[1]);
                fullMessage = decodeXmlEntities(failureMatch[2]);
            }
        } else if (content.includes('<error')) {
            status = 'error';
            const errorMatch = /<error[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/error>/.exec(content);
            if (errorMatch) {
                message = decodeXmlEntities(errorMatch[1]);
                fullMessage = decodeXmlEntities(errorMatch[2]);
            }
        } else if (content.includes('<skipped')) {
            status = 'skipped';
            const skippedMatch = /<skipped[^>]*message="([^"]*)"/.exec(content);
            if (skippedMatch) {
                message = decodeXmlEntities(skippedMatch[1]);
            }
        }
        
        tests.push({
            name,
            className,
            time,
            status,
            message: message || undefined,
            fullMessage: fullMessage || undefined
        });
    }
    
    return tests;
}

/**
 * Check if XML content contains test results
 * Useful for validating XML files before parsing
 */
export function hasTestResults(xmlContent: string): boolean {
    return xmlContent.includes('<testcase') || xmlContent.includes('<testsuite');
}

