/**
 * Evolv API Client for evolvtalent.ai LMS
 * Implements the LMSApiClient interface for Evolv's API
 */

import * as https from 'https';
import { readRevatureConfig } from '../revatureConfig';
import { LMSApiClient, TestExecutionData, SessionEventData } from './lmsClient.interface';

interface ExecutionRecordPayload {
    cloudLabWorkspaceId: string;
    cloudLabLocation: string;
    learnerCurriculumActivityId: string;
    labExecutionRecords: {
        testCaseMessage: string;
        passedTestCaseCount: number;
        totalTestCaseCount: number;
        failedTestCaseCount: number;
        erroredTestCaseCount: number;
        skippedTestCaseCount: number;
    };
}

interface SessionDataPayload {
    cloudLabWorkspaceId: string;
    learnerCurriculumActivityId: string;
    activityType: string;
    cloudLabSessionDetailsDTO: Array<{
        sessionEvent: string;
        sessionActiveTime: string;
    }>;
}

export class EvolvApiClient implements LMSApiClient {
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
            console.warn('[EvolvApiClient] API_KEY not found in .revature config');
        }
    }

    public isEnabled(): boolean {
        return this.enabled && !!this.apiKey;
    }

    public getBaseUrl(): string {
        return this.baseUrl;
    }

    public async sendTestResults(
        workspaceLocation: string,
        testData: TestExecutionData
    ): Promise<void> {
        if (!this.isEnabled()) {
            console.log('[EvolvApiClient] API client is disabled or not configured');
            return;
        }

        const config = readRevatureConfig();
        
        if (!config) {
            console.warn('[EvolvApiClient] Cannot send test results: .revature config not found');
            return;
        }

        if (!config.CLOUD_LAB_WORKSPACE_ID || !config.LEARNER_CURRICULUM_ACTIVITY_ID) {
            console.warn('[EvolvApiClient] Cannot send test results: required Evolv config fields missing');
            return;
        }

        const payload: ExecutionRecordPayload = {
            cloudLabWorkspaceId: config.CLOUD_LAB_WORKSPACE_ID,
            cloudLabLocation: workspaceLocation,
            learnerCurriculumActivityId: config.LEARNER_CURRICULUM_ACTIVITY_ID,
            labExecutionRecords: {
                testCaseMessage: testData.testCaseMessage,
                passedTestCaseCount: testData.passedTests,
                totalTestCaseCount: testData.totalTests,
                failedTestCaseCount: testData.failedTests,
                erroredTestCaseCount: testData.erroredTests,
                skippedTestCaseCount: testData.skippedTests
            }
        };

        const endpoint = '/learning/api/v1/unsecure/cloud-lab/execution-record';
        
        try {
            await this.makeRequest(endpoint, payload);
            console.log(`[EvolvApiClient] Successfully sent test results to ${this.baseUrl}${endpoint}`);
        } catch (error) {
            console.error('[EvolvApiClient] Failed to send test results:', error);
            console.error('Request details:', {
                url: `${this.baseUrl}${endpoint}`,
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey ? `${this.apiKey.substring(0, 8)}...` : 'NOT_SET',
                    'Content-Type': 'application/json'
                },
                payload: JSON.stringify(payload, null, 2)
            });
            throw error;
        }
    }

    public async sendSessionEvent(eventData: SessionEventData): Promise<void> {
        if (!this.isEnabled()) {
            console.log('[EvolvApiClient] API client is disabled or not configured');
            return;
        }

        const config = readRevatureConfig();
        
        if (!config) {
            console.warn('[EvolvApiClient] Cannot send session event: .revature config not found');
            return;
        }

        if (!config.CLOUD_LAB_WORKSPACE_ID || 
            !config.LEARNER_CURRICULUM_ACTIVITY_ID || 
            !config.ACTIVITY_TYPE) {
            console.warn('[EvolvApiClient] Cannot send session event: required Evolv config fields missing');
            return;
        }

        const timestamp = eventData.sessionActiveTime || new Date();
        
        const payload: SessionDataPayload = {
            cloudLabWorkspaceId: config.CLOUD_LAB_WORKSPACE_ID,
            learnerCurriculumActivityId: config.LEARNER_CURRICULUM_ACTIVITY_ID,
            activityType: config.ACTIVITY_TYPE,
            cloudLabSessionDetailsDTO: [
                {
                    sessionEvent: eventData.sessionEvent,
                    sessionActiveTime: timestamp.toISOString()
                }
            ]
        };

        const endpoint = '/learning/api/v1/unsecure/cloud-lab/session-data';
        
        try {
            await this.makeRequest(endpoint, payload);
            console.log(`[EvolvApiClient] Successfully sent session event: ${eventData.sessionEvent}`);
        } catch (error) {
            console.error('[EvolvApiClient] Failed to send session event:', error);
            console.error('Request details:', {
                url: `${this.baseUrl}${endpoint}`,
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey ? `${this.apiKey.substring(0, 8)}...` : 'NOT_SET',
                    'Content-Type': 'application/json'
                },
                payload: JSON.stringify(payload, null, 2)
            });
            throw error;
        }
    }

    /**
     * Make HTTPS request to Evolv API
     */
    private makeRequest(endpoint: string, payload: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.baseUrl);
            const postData = JSON.stringify(payload);

            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey,
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

