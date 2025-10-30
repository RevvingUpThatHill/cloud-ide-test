/**
 * Test case file generator for Revature API format
 * Generates custom format: %TESTE  {num},{testName}({className}),%RUNTIME{ms},[PASS|FAIL]
 */

export interface TestCase {
    name: string;
    status: 'passed' | 'failed' | 'error' | 'skipped';
    duration?: number;
    filePath?: string;
}

export interface TestCaseFileContent {
    content: string;          // Human-readable format
    byteArray: number[];      // Byte array for API
}

/**
 * Generate test case file content in Revature format
 * Format: %TESTE  {num},{testName}({className}),%RUNTIME{ms},[PASS|FAIL]
 * 
 * Note: Errors and skipped tests are treated as FAIL
 */
export function generateTestCaseFile(tests: TestCase[]): TestCaseFileContent {
    const lines: string[] = [];
    
    tests.forEach((test, index) => {
        const testNumber = index + 1;
        
        // Extract class name from test name or file path
        // Examples:
        //   "Calculator.testAdd" -> className = "Calculator"
        //   "test/CalculatorTest.py::testAdd" -> className = "CalculatorTest"
        //   "testAdd" -> className = "TestClass" (fallback)
        const className = extractClassName(test.name, test.filePath);
        
        // Get test method name (remove class prefix if present)
        const testMethodName = extractTestMethodName(test.name);
        
        // Get duration in milliseconds (default to 0 if not available)
        const duration = test.duration || 0;
        
        // Determine pass/fail status
        // Note: errors and skipped tests are treated as FAIL
        const status = test.status === 'passed' ? 'PASS' : 'FAIL';
        
        // Generate line in Revature format
        // Format: %TESTE  {num},{testName}({className}),%RUNTIME{ms},[PASS|FAIL]
        const line = `%TESTE  ${testNumber},${testMethodName}(${className}),%RUNTIME${duration},${status}`;
        lines.push(line);
    });
    
    // Join all lines with newline
    const content = lines.join('\n');
    
    // Log human-readable version to console
    console.log('[TestCaseFile] Generated test case file content:');
    console.log('=====================================');
    console.log(content);
    console.log('=====================================');
    
    // Convert to byte array
    const byteArray = Array.from(Buffer.from(content, 'utf8'));
    
    console.log(`[TestCaseFile] Byte array length: ${byteArray.length} bytes`);
    
    return {
        content,
        byteArray
    };
}

/**
 * Extract class name from test name or file path
 */
function extractClassName(testName: string, filePath?: string): string {
    // Try to extract from test name first
    // Pattern 1: "ClassName.testMethod" or "ClassName::testMethod"
    const classFromName = testName.match(/^([A-Za-z0-9_]+)[.:]/);
    if (classFromName) {
        return classFromName[1];
    }
    
    // Try to extract from file path
    // Pattern 2: "test/ClassName.test.js" or "test/ClassNameTest.py"
    if (filePath) {
        const fileMatch = filePath.match(/\/([A-Za-z0-9_]+)(?:Test|\.test|\.spec)/i);
        if (fileMatch) {
            return fileMatch[1] + 'Test';
        }
        
        // Pattern 3: "test/ClassName.js"
        const simpleMatch = filePath.match(/\/([A-Za-z0-9_]+)\.[a-z]+$/i);
        if (simpleMatch) {
            return simpleMatch[1];
        }
    }
    
    // Fallback: use generic name
    return 'TestClass';
}

/**
 * Extract test method name from full test name
 * Removes class prefix if present
 */
function extractTestMethodName(testName: string): string {
    // Remove class prefix if present
    // "ClassName.testMethod" -> "testMethod"
    // "ClassName::testMethod" -> "testMethod"
    const parts = testName.split(/[.:]/);
    if (parts.length > 1) {
        return parts[parts.length - 1];
    }
    
    return testName;
}

