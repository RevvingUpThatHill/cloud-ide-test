/**
 * API Client for sending execution records and session data to Revature cloud lab API
 */

import * as https from 'https';
import { readRevatureConfig } from './revatureConfig';
import { getConfig } from './config';

export interface TestExecutionRecord {
    testCaseMessage: string;
    passedTestCaseCount: number;
    totalTestCaseCount: number;
    failedTestCaseCount: number;
    erroredTestCaseCount: number;
    skippedTestCaseCount: number;
}

export interface SessionEvent {
    sessionEvent: string;
    sessionActiveTime: string; // ISO 8601 format
}

export interface ExecutionRecordPayload {
    cloudLabWorkspaceId: string;
    cloudLabLocation: string;
    learnerCurriculumActivityId: string;
    labExecutionRecords: TestExecutionRecord;
}

export interface SessionDataPayload {
    cloudLabWorkspaceId: string;
    learnerCurriculumActivityId: string;
    activityType: string;
    cloudLabSessionDetailsDTO: SessionEvent[];
}

export class ApiClient {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly enabled: boolean;

    constructor(baseUrl?: string) {
        try {
            const config = getConfig();
            this.baseUrl = baseUrl || config.api.baseUrl;
            this.enabled = config.api.enabled;
        } catch {
            // If config is not available, fall back to defaults
            this.baseUrl = baseUrl || 'https://dev-api.evolvtalent.ai';
            this.enabled = true;
        }

        // Read API key from .revature config
        const revatureConfig = readRevatureConfig();
        this.apiKey = revatureConfig?.API_KEY || '';
        
        if (!this.apiKey) {
            console.warn('API_KEY not found in .revature config. API calls will fail.');
        }
    }

    /**
     * Send test execution record to the API
     */
    public async sendExecutionRecord(
        workspaceLocation: string,
        testCaseMessage: string,
        passedCount: number,
        totalCount: number,
        failedCount: number,
        erroredCount: number,
        skippedCount: number
    ): Promise<void> {
        if (!this.enabled) {
            console.log('API client is disabled, skipping execution record');
            return;
        }

        if (!this.apiKey) {
            console.warn('Cannot send execution record: API_KEY not configured');
            return;
        }

        const config = readRevatureConfig();
        
        if (!config) {
            console.warn('Cannot send execution record: .revature config not found');
            return;
        }

        if (!config.CLOUD_LAB_WORKSPACE_ID || !config.LEARNER_CURRICULUM_ACTIVITY_ID) {
            console.warn('Cannot send execution record: required config fields missing');
            return;
        }

        const payload: ExecutionRecordPayload = {
            cloudLabWorkspaceId: config.CLOUD_LAB_WORKSPACE_ID,
            cloudLabLocation: workspaceLocation,
            learnerCurriculumActivityId: config.LEARNER_CURRICULUM_ACTIVITY_ID,
            labExecutionRecords: {
                testCaseMessage,
                passedTestCaseCount: passedCount,
                totalTestCaseCount: totalCount,
                failedTestCaseCount: failedCount,
                erroredTestCaseCount: erroredCount,
                skippedTestCaseCount: skippedCount
            }
        };

        const endpoint = '/learning/api/v1/unsecure/cloud-lab/execution-record';
        
        try {
            await this.makeRequest(endpoint, payload);
            console.log(`Successfully sent execution record to API: ${this.baseUrl}${endpoint}`);
        } catch (error) {
            console.error('Failed to send execution record:', error);
            console.error('Request details:', {
                url: `${this.baseUrl}${endpoint}`,
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey ? `${this.apiKey.substring(0, 8)}...` : 'NOT_SET',
                    'Content-Type': 'application/json'
                },
                payload: JSON.stringify(payload, null, 2)
            });
        }
    }

    /**
     * Send session data to the API
     */
    public async sendSessionData(
        sessionEvent: string,
        sessionActiveTime?: Date
    ): Promise<void> {
        if (!this.enabled) {
            console.log('API client is disabled, skipping session data');
            return;
        }

        if (!this.apiKey) {
            console.warn('Cannot send session data: API_KEY not configured');
            return;
        }

        const config = readRevatureConfig();
        
        if (!config) {
            console.warn('Cannot send session data: .revature config not found');
            return;
        }

        if (!config.CLOUD_LAB_WORKSPACE_ID || 
            !config.LEARNER_CURRICULUM_ACTIVITY_ID || 
            !config.ACTIVITY_TYPE) {
            console.warn('Cannot send session data: required config fields missing');
            return;
        }

        const timestamp = sessionActiveTime || new Date();
        
        const payload: SessionDataPayload = {
            cloudLabWorkspaceId: config.CLOUD_LAB_WORKSPACE_ID,
            learnerCurriculumActivityId: config.LEARNER_CURRICULUM_ACTIVITY_ID,
            activityType: config.ACTIVITY_TYPE,
            cloudLabSessionDetailsDTO: [
                {
                    sessionEvent,
                    sessionActiveTime: timestamp.toISOString()
                }
            ]
        };

        const endpoint = '/learning/api/v1/unsecure/cloud-lab/session-data';
        
        try {
            await this.makeRequest(endpoint, payload);
            console.log(`Successfully sent session data: ${sessionEvent} to ${this.baseUrl}${endpoint}`);
        } catch (error) {
            console.error('Failed to send session data:', error);
            console.error('Request details:', {
                url: `${this.baseUrl}${endpoint}`,
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey ? `${this.apiKey.substring(0, 8)}...` : 'NOT_SET',
                    'Content-Type': 'application/json'
                },
                payload: JSON.stringify(payload, null, 2)
            });
        }
    }

    /**
     * Make HTTPS request to API
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

// Singleton instance
let apiClientInstance: ApiClient | null = null;

export function getApiClient(): ApiClient {
    if (!apiClientInstance) {
        apiClientInstance = new ApiClient();
    }
    return apiClientInstance;
}

