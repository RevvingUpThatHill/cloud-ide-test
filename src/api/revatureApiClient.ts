/**
 * Revature API Client for revature.com LMS
 * Implements the LMSApiClient interface for Revature's API
 * 
 * This client handles:
 * - Session tracking (extension activation)
 * - Test case reporting (simplified - no file byte array needed)
 * - Commit status updates (reports that commit happened)
 * - Git commit and push
 * 
 * Flow: Commit → Run Tests → Send /test-case → Send /commit-status → Push
 * (User clicking "Run Tests" means they're done coding, so commit happens first)
 */

import * as https from 'https';
import { readRevatureConfig } from '../revatureConfig';
import { LMSApiClient, TestExecutionData, SessionEventData } from './lmsClient.interface';
import { commitAndCaptureMetadata, pushToRemote } from '../git/gitService';

interface RevatureTestCasePayload {
    revproWorkspaceId: string;
    projectCode: string; // PT001 (project) or PT002 (assignment)
    cloudLabTestcasesDTO: {
        fileName: string;
        testcaseMessage: string;
        file: number[]; // Empty array - not needed per feedback
        viaCommitted: boolean; // false - no git commit needed upfront
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

interface RevatureCommitStatusPayload {
    revproWorkspaceId: string;
    projectCode: string;
}

export class RevatureApiClient implements LMSApiClient {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly enabled: boolean;

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
     * Flow: Commit → (tests already ran) → Send test-case → Send commit-status → Push
     * User clicking "Run Tests" means they're done coding, so commit happens first
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
            // Step 1: Commit changes (user is done coding when they run tests)
            console.log('[RevatureApiClient] Committing changes...');
            const commitMessage = `Test run: ${testData.passedTests}/${testData.totalTests} passed, ${testData.failedTests} failed, ${testData.skippedTests} skipped - ${new Date().toISOString()}`;
            const commitMetadata = await commitAndCaptureMetadata(workspaceLocation, commitMessage);
            
            if (!commitMetadata) {
                console.log('[RevatureApiClient] No changes to commit, skipping API calls');
                return;
            }
            console.log('[RevatureApiClient] Commit successful:', commitMetadata.commitSha);
            
            // Step 2: Send test-case endpoint with test results
            console.log('[RevatureApiClient] Sending test case results to API...');
            await this.sendTestCase(
                config.REVPRO_WORKSPACE_ID,
                config.PROJECT_TYPE,
                testData.testCaseMessage
            );
            console.log('[RevatureApiClient] Test case results sent successfully');
            
            // Step 3: Send commit-status (report that commit happened)
            console.log('[RevatureApiClient] Updating commit status...');
            await this.sendCommitStatus(
                config.REVPRO_WORKSPACE_ID,
                config.PROJECT_TYPE
            );
            console.log('[RevatureApiClient] Commit status updated successfully');
            
            // Step 4: Push to remote
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
     * Send test case results to Revature API (new simplified endpoint)
     * No git metadata or file byte array needed
     */
    private async sendTestCase(
        revproWorkspaceId: string,
        projectCode: string,
        testCaseMessage: string
    ): Promise<void> {
        const payload: RevatureTestCasePayload = {
            revproWorkspaceId,
            projectCode, // PT001 (project) or PT002 (assignment)
            cloudLabTestcasesDTO: {
                fileName: 'testCases_log.txt',
                testcaseMessage: testCaseMessage,
                file: [], // Empty array - not needed per feedback
                viaCommitted: false
            }
        };

        const endpoint = '/apigateway/associates/secure/cloud-lab/test-case';
        
        try {
            await this.makeRequest(endpoint, payload, 'POST');
        } catch (error) {
            console.error('[RevatureApiClient] Failed to send test case:', error);
            throw error;
        }
    }

    /**
     * Update commit status (PATCH request)
     * Called after test-case is sent successfully - indicates user "initiated commit"
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

