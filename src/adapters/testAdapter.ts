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
    fullOutput?: string; // Full stack trace or detailed output for detail panel
    filePath?: string; // File path for the test (used to match duplicate test names)
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
    command?: string; // The command that was used to run tests
}

