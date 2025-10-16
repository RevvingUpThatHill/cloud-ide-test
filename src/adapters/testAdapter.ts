/**
 * Interface for test adapters
 */
export interface TestAdapter {
    discoverTests(directory: string): Promise<DiscoveredTest[]>;
    runTests(directory: string): Promise<TestResult>;
}

/**
 * Structure for discovered test (before execution)
 */
export interface DiscoveredTest {
    name: string;
    filePath: string;
}

/**
 * Test execution state
 */
export type TestState = 'not-run' | 'running' | 'passed' | 'failed' | 'error' | 'skipped';

/**
 * Structure for individual test result
 */
export interface TestCase {
    name: string;
    status: 'passed' | 'failed' | 'skipped' | 'error';
    errorType?: 'assertion' | 'exception'; // Distinguish between test failure and error
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

