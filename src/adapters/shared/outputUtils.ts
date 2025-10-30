/**
 * Shared output utilities for test adapters
 * Handles ANSI escape codes, output cleaning, and formatting
 */

/**
 * Remove ANSI escape codes from text
 * ANSI codes are used for terminal colors and formatting
 * Pattern matches: ESC[<params><letter>
 */
export function cleanAnsiEscapeCodes(text: string): string {
    return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Generate full output string from stdout and stderr
 * Cleans ANSI codes and formats for display
 */
export function generateFullOutput(stdout: string, stderr: string): string {
    const cleanStdout = cleanAnsiEscapeCodes(stdout);
    const cleanStderr = cleanAnsiEscapeCodes(stderr);
    
    return `=== STDOUT ===\n${cleanStdout}\n\n=== STDERR ===\n${cleanStderr}`;
}

/**
 * Extract first N lines from text
 * Useful for truncating long error messages
 */
export function extractFirstLines(text: string, count: number): string {
    return text.split('\n').slice(0, count).join('\n');
}

/**
 * Truncate text to maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Format stack trace by extracting relevant lines
 * Filters out framework internal lines and highlights user code
 */
export interface StackTraceLine {
    method: string;
    file: string;
    line: number;
    isUserCode: boolean;
}

/**
 * Parse a stack trace line in the format:
 *   at method(file:line:column)
 * or:
 *   at method (file:line:column)
 */
export function parseStackTraceLine(line: string): StackTraceLine | null {
    // Pattern 1: "at method(file:line:column)"
    const pattern1 = /^\s*at\s+([^\(]+)\(([^:]+):(\d+)(?::\d+)?\)/;
    const match1 = pattern1.exec(line);
    
    if (match1) {
        const method = match1[1].trim();
        const file = match1[2].trim();
        const lineNum = parseInt(match1[3], 10);
        const isUserCode = !isFrameworkCode(file, method);
        
        return { method, file, line: lineNum, isUserCode };
    }
    
    // Pattern 2: "at file:line:column" (no method)
    const pattern2 = /^\s*at\s+([^:]+):(\d+)(?::\d+)?/;
    const match2 = pattern2.exec(line);
    
    if (match2) {
        const file = match2[1].trim();
        const lineNum = parseInt(match2[2], 10);
        const isUserCode = !isFrameworkCode(file, '');
        
        return { method: '', file, line: lineNum, isUserCode };
    }
    
    return null;
}

/**
 * Determine if a file/method is framework code (not user code)
 * Used to filter stack traces
 */
function isFrameworkCode(file: string, method: string): boolean {
    const frameworkPatterns = [
        'node_modules',
        'internal/',
        'java.',
        'sun.',
        'jdk.',
        'org.junit',
        'karma',
        'jasmine',
        'webpack',
        '<anonymous>',
        'zone.js'
    ];
    
    const combined = file + ' ' + method;
    return frameworkPatterns.some(pattern => combined.includes(pattern));
}

/**
 * Extract the first user code line from a stack trace
 * Returns formatted string like: "at Calculator.java:42 in add()"
 */
export function extractFirstUserCodeLine(stackTrace: string): string | null {
    const lines = stackTrace.split('\n');
    
    for (const line of lines) {
        const parsed = parseStackTraceLine(line);
        if (parsed && parsed.isUserCode) {
            const fileName = parsed.file.split('/').pop() || parsed.file;
            if (parsed.method) {
                return `at ${fileName}:${parsed.line} in ${parsed.method}()`;
            } else {
                return `at ${fileName}:${parsed.line}`;
            }
        }
    }
    
    return null;
}

/**
 * Format an error with stack trace for display
 * Returns a concise, readable error message
 */
export function formatError(
    errorType: string,
    errorMessage: string,
    stackTrace?: string
): string {
    const parts: string[] = [];
    
    // Add error type and message
    const simpleType = errorType.split('.').pop() || errorType;
    parts.push(`${simpleType}: ${errorMessage}`);
    
    // Add first user code line if available
    if (stackTrace) {
        const userCodeLine = extractFirstUserCodeLine(stackTrace);
        if (userCodeLine) {
            parts.push(`  ${userCodeLine}`);
        }
    }
    
    return parts.join('\n');
}

/**
 * Parse error section from console output
 * Extracts error details between markers
 */
export function extractErrorSection(
    output: string,
    startMarker: string,
    endMarker?: string
): string | null {
    const startIndex = output.indexOf(startMarker);
    if (startIndex === -1) {
        return null;
    }
    
    if (!endMarker) {
        return output.substring(startIndex);
    }
    
    const endIndex = output.indexOf(endMarker, startIndex + startMarker.length);
    if (endIndex === -1) {
        return output.substring(startIndex);
    }
    
    return output.substring(startIndex, endIndex);
}

