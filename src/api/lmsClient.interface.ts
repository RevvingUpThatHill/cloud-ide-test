/**
 * Common interface for LMS (Learning Management System) API clients
 * Both Evolv and Revature implementations must implement this interface
 */

export interface TestExecutionData {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    erroredTests: number;
    skippedTests: number;
    testCaseMessage: string;
}

export interface SessionEventData {
    sessionEvent: string;
    sessionActiveTime?: Date;
}

/**
 * Base interface that all LMS API clients must implement
 */
export interface LMSApiClient {
    /**
     * Send test execution results to the LMS
     */
    sendTestResults(
        workspaceLocation: string,
        testData: TestExecutionData
    ): Promise<void>;

    /**
     * Send session event (e.g., session started, file saved)
     */
    sendSessionEvent(
        eventData: SessionEventData
    ): Promise<void>;

    /**
     * Check if the API client is properly configured and enabled
     */
    isEnabled(): boolean;

    /**
     * Get the base URL this client is configured for
     */
    getBaseUrl(): string;
}

