/**
 * Interface for test adapters
 */
export interface TestAdapter {
    runTests(directory: string): Promise<TestResult>;
}

/**
 * Structure for individual test result
 */
export interface TestCase {
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    duration?: number;
    message?: string;
    expected?: string;
    actual?: string;
}

/**
 * Structure for overall test results
 */
export interface TestResult {
    tests: TestCase[];
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
}

