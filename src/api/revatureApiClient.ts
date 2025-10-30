/**
 * Revature API Client for revature.com LMS
 * Implements the LMSApiClient interface for Revature's API
 * 
 * This client handles:
 * - Session tracking (extension activation)
 * - Git commit with metadata capture
 * - Test case reporting with custom file format
 * - Commit status updates
 * - Git push (only after successful API calls)
 */

import * as https from 'https';
import { readRevatureConfig } from '../revatureConfig';
import { LMSApiClient, TestExecutionData, SessionEventData } from './lmsClient.interface';
import { commitAndCaptureMetadata, pushToRemote, CommitMetadata } from '../git/gitService';
import { generateTestCaseFile, TestCase } from '../utils/testCaseFileGenerator';

interface RevatureTestCasePayload {
    revproWorkspaceId: string;
    projectCode: string;
    cloudLabTestcasesDTO: {
        fileName: string;
        testcaseMessage: string;
        file: number[];
        viaCommitted: boolean;
    };
}

interface RevatureSessionPayload {
    revproWorkspaceId: string;
    gitpodWorkspaceId: string;
    projectCode: string;
    cloudLabSessionDetailsDTO: Array<{
        sessionEvent: string;
        sessionActiveTime: string;
    }>;
}

interface RevatureCommitPayload {
    revproWorkspaceId: string;
    gitpodWorkspaceId: string;
    projectCode: string;
    cloudLabCommitDetailsDTO: {
        commitedTime: string;
        gitUserName: string;
        repositoryUrl: string;
        commitSha: string;
        commitMessage: string;
        filesChanged: number;
        insertions: number;
        deletions: number;
        lineCount: number;
    };
    cloudLabTestcasesDTO: {
        fileName: string;
        testcaseMessage: string;
        file: number[];
        viaCommitted: boolean;
    };
}

interface RevatureCommitStatusPayload {
    revproWorkspaceId: string;
    projectCode: string;
}

export class RevatureApiClient implements LMSApiClient {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly enabled: boolean;
    private lastCommitMetadata: CommitMetadata | null = null;

    constructor(baseUrl: string, enabled: boolean = true) {
        this.baseUrl = baseUrl;
        this.enabled = enabled;

        // Read API key from .revature config
        const revatureConfig = readRevatureConfig();
        this.apiKey = revatureConfig?.API_KEY || '';
        
        if (!this.apiKey) {
            console.warn('[RevatureApiClient] API_KEY not found in .revature config');
        }
    }

    public isEnabled(): boolean {
        return this.enabled && !!this.apiKey;
    }

    public getBaseUrl(): string {
        return this.baseUrl;
    }

    /**
     * Send test results to Revature API
     * Flow: Commit → Capture metadata → Send commit-details → Send commit-status → Push
     */
    public async sendTestResults(
        workspaceLocation: string,
        testData: TestExecutionData
    ): Promise<void> {
        if (!this.isEnabled()) {
            console.log('[RevatureApiClient] API client is disabled or not configured');
            return;
        }

        const config = readRevatureConfig();
        
        if (!config) {
            console.warn('[RevatureApiClient] Cannot send test results: .revature config not found');
            return;
        }

        if (!config.REVPRO_WORKSPACE_ID || !config.PROJECT_TYPE) {
            console.warn('[RevatureApiClient] Cannot send test results: required Revature config fields missing');
            console.warn('Required fields: REVPRO_WORKSPACE_ID, PROJECT_TYPE');
            return;
        }

        try {
            // Step 1: Create commit message
            const commitMessage = `Test run: ${testData.passedTests}/${testData.totalTests} passed, ${testData.failedTests} failed, ${testData.skippedTests} skipped - ${new Date().toISOString()}`;
            
            // Step 2: Commit and capture metadata
            console.log('[RevatureApiClient] Committing changes...');
            const commitMetadata = await commitAndCaptureMetadata(workspaceLocation, commitMessage);
            
            if (!commitMetadata) {
                console.log('[RevatureApiClient] No changes to commit, skipping API calls');
                return;
            }
            
            this.lastCommitMetadata = commitMetadata;
            console.log('[RevatureApiClient] Commit successful:', commitMetadata.commitSha);
            
            // Step 3: Generate test case file (custom Revature format)
            // Note: We need to extract test cases from testData
            // For now, we'll create a simplified representation
            // In a real implementation, this would be passed from the test runner
            const testCaseFile = this.generateTestCaseFileFromData(testData);
            
            // Step 4: Send commit-details with test cases
            console.log('[RevatureApiClient] Sending commit details to API...');
            await this.sendCommitDetails(
                config.REVPRO_WORKSPACE_ID,
                config.PROJECT_TYPE,
                commitMetadata,
                testCaseFile.byteArray,
                testData.testCaseMessage
            );
            console.log('[RevatureApiClient] Commit details sent successfully');
            
            // Step 5: Send commit-status (PATCH)
            console.log('[RevatureApiClient] Updating commit status...');
            await this.sendCommitStatus(
                config.REVPRO_WORKSPACE_ID,
                config.PROJECT_TYPE
            );
            console.log('[RevatureApiClient] Commit status updated successfully');
            
            // Step 6: Push to remote (only if all API calls succeeded)
            console.log('[RevatureApiClient] Pushing to remote...');
            await pushToRemote(workspaceLocation);
            console.log('[RevatureApiClient] Push successful');
            
        } catch (error) {
            console.error('[RevatureApiClient] Failed to send test results:', error);
            throw error;
        }
    }

    /**
     * Send session event to Revature API
     * This is called when the extension is activated
     */
    public async sendSessionEvent(eventData: SessionEventData): Promise<void> {
        if (!this.isEnabled()) {
            console.log('[RevatureApiClient] API client is disabled or not configured');
            return;
        }

        const config = readRevatureConfig();
        
        if (!config) {
            console.warn('[RevatureApiClient] Cannot send session event: .revature config not found');
            return;
        }

        if (!config.REVPRO_WORKSPACE_ID || !config.PROJECT_TYPE) {
            console.warn('[RevatureApiClient] Cannot send session event: required Revature config fields missing');
            return;
        }

        const timestamp = eventData.sessionActiveTime || new Date();
        
        const payload: RevatureSessionPayload = {
            revproWorkspaceId: config.REVPRO_WORKSPACE_ID,
            gitpodWorkspaceId: config.GITPOD_WORKSPACE_CONTEXT_URL || '',
            projectCode: config.PROJECT_TYPE,
            cloudLabSessionDetailsDTO: [
                {
                    sessionEvent: eventData.sessionEvent,
                    sessionActiveTime: timestamp.toISOString()
                }
            ]
        };

        const endpoint = '/apigateway/associates/secure/cloud-lab/session-details';
        
        try {
            await this.makeRequest(endpoint, payload, 'POST');
            console.log(`[RevatureApiClient] Successfully sent session event: ${eventData.sessionEvent}`);
        } catch (error) {
            console.error('[RevatureApiClient] Failed to send session event:', error);
            throw error;
        }
    }

    /**
     * Send commit details with test cases to Revature API
     */
    private async sendCommitDetails(
        revproWorkspaceId: string,
        projectCode: string,
        commitMetadata: CommitMetadata,
        testCaseFileBytes: number[],
        testCaseMessage: string
    ): Promise<void> {
        const config = readRevatureConfig();
        
        const payload: RevatureCommitPayload = {
            revproWorkspaceId,
            gitpodWorkspaceId: config?.GITPOD_WORKSPACE_CONTEXT_URL || commitMetadata.repositoryUrl,
            projectCode,
            cloudLabCommitDetailsDTO: {
                commitedTime: commitMetadata.commitTime,
                gitUserName: commitMetadata.gitUserName,
                repositoryUrl: commitMetadata.repositoryUrl,
                commitSha: commitMetadata.commitSha,
                commitMessage: commitMetadata.commitMessage,
                filesChanged: commitMetadata.filesChanged,
                insertions: commitMetadata.insertions,
                deletions: commitMetadata.deletions,
                lineCount: commitMetadata.lineCount
            },
            cloudLabTestcasesDTO: {
                fileName: 'testCases_log.txt',
                testcaseMessage: testCaseMessage,
                file: testCaseFileBytes,
                viaCommitted: false // False for now; true when git hooks are implemented
            }
        };

        const endpoint = '/apigateway/associates/secure/cloud-lab/commit-details';
        
        try {
            await this.makeRequest(endpoint, payload, 'POST');
        } catch (error) {
            console.error('[RevatureApiClient] Failed to send commit details:', error);
            throw error;
        }
    }

    /**
     * Update commit status (PATCH request)
     * Called after commit-details is sent successfully
     */
    private async sendCommitStatus(
        revproWorkspaceId: string,
        projectCode: string
    ): Promise<void> {
        const payload: RevatureCommitStatusPayload = {
            revproWorkspaceId,
            projectCode
        };

        const endpoint = '/apigateway/associates/secure/cloud-lab/commit-status';
        
        try {
            await this.makeRequest(endpoint, payload, 'PATCH');
        } catch (error) {
            console.error('[RevatureApiClient] Failed to update commit status:', error);
            throw error;
        }
    }

    /**
     * Generate test case file from test execution data
     * This creates a simplified version since we don't have individual test details here
     * In a full implementation, this would receive the complete test results array
     */
    private generateTestCaseFileFromData(testData: TestExecutionData): { content: string; byteArray: number[] } {
        // Create synthetic test cases for the custom format
        // In real usage, the caller should provide the actual test cases
        // For now, we'll generate a summary entry
        const syntheticTestCases: TestCase[] = [];
        
        // Create entries for passed tests
        for (let i = 0; i < testData.passedTests; i++) {
            syntheticTestCases.push({
                name: `test${i + 1}`,
                status: 'passed',
                duration: 0
            });
        }
        
        // Create entries for failed tests
        for (let i = 0; i < testData.failedTests; i++) {
            syntheticTestCases.push({
                name: `test${testData.passedTests + i + 1}`,
                status: 'failed',
                duration: 0
            });
        }
        
        // Create entries for errored tests
        for (let i = 0; i < testData.erroredTests; i++) {
            syntheticTestCases.push({
                name: `test${testData.passedTests + testData.failedTests + i + 1}`,
                status: 'error',
                duration: 0
            });
        }
        
        return generateTestCaseFile(syntheticTestCases);
    }

    /**
     * Make HTTPS request to Revature API
     * Uses different header name: 'cloudlab-api-access-key' instead of 'x-api-key'
     */
    private makeRequest(endpoint: string, payload: any, method: 'POST' | 'PATCH' = 'POST'): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.baseUrl);
            const postData = JSON.stringify(payload);

            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: method,
                headers: {
                    'cloudlab-api-access-key': this.apiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        const errorDetails = {
                            statusCode: res.statusCode,
                            statusMessage: res.statusMessage,
                            headers: res.headers,
                            body: data
                        };
                        reject(new Error(`API request failed with status ${res.statusCode}: ${JSON.stringify(errorDetails, null, 2)}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }
}

