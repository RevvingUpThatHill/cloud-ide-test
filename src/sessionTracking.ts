/**
 * Session Tracking Service
 * Tracks user activity and sends events to LMS API
 * 
 * Supported events:
 * - Session Started (extension activation)
 * - Session Ended (extension deactivation - best effort)
 * - onDidSaveTextDocument (file save)
 * - onDidChangeTextDocument (text changes - debounced per document)
 * - onDidRenameFiles (file rename)
 * - onDidDeleteFiles (file delete)
 * - onDidCreateFiles (file create)
 * - onDidChangeBreakpoints (breakpoint changes)
 * - onDidStartDebugSession (debug start)
 * - onDidTerminateDebugSession (debug end)
 */

import * as vscode from 'vscode';
import { LMSApiClient } from './api/lmsClient.interface';

export class SessionTrackingService {
    private apiClient: LMSApiClient;
    private disposables: vscode.Disposable[] = [];
    
    // Debounce timers for text document changes (per document URI)
    private changeDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private readonly DEBOUNCE_DELAY_MS = 5000; // 5 seconds

    constructor(apiClient: LMSApiClient) {
        this.apiClient = apiClient;
    }

    /**
     * Initialize all session tracking listeners
     */
    public initialize(): void {
        console.log('[SessionTracking] Initializing session tracking...');
        
        // Track file save events
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((document) => {
                this.sendEvent('onDidSaveTextDocument');
            })
        );

        // Track text document changes (debounced per document)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                this.handleTextDocumentChange(event.document);
            })
        );

        // Track file rename events
        this.disposables.push(
            vscode.workspace.onDidRenameFiles((event) => {
                this.sendEvent('onDidRenameFiles');
            })
        );

        // Track file delete events
        this.disposables.push(
            vscode.workspace.onDidDeleteFiles((event) => {
                this.sendEvent('onDidDeleteFiles');
            })
        );

        // Track file create events
        this.disposables.push(
            vscode.workspace.onDidCreateFiles((event) => {
                this.sendEvent('onDidCreateFiles');
            })
        );

        // Track breakpoint changes
        this.disposables.push(
            vscode.debug.onDidChangeBreakpoints((event) => {
                this.sendEvent('onDidChangeBreakpoints');
            })
        );

        // Track debug session start
        this.disposables.push(
            vscode.debug.onDidStartDebugSession((session) => {
                this.sendEvent('onDidStartDebugSession');
            })
        );

        // Track debug session termination
        this.disposables.push(
            vscode.debug.onDidTerminateDebugSession((session) => {
                this.sendEvent('onDidTerminateDebugSession');
            })
        );

        console.log('[SessionTracking] Session tracking initialized successfully');
    }

    /**
     * Send "Session Started" event
     * Called when extension activates
     */
    public sendSessionStarted(): void {
        this.sendEvent('Session Started');
    }

    /**
     * Send "Session Ended" event
     * Called when extension deactivates (best effort - may not fire on browser tab close)
     */
    public sendSessionEnded(): void {
        console.log('[SessionTracking] Attempting to send Session Ended event...');
        this.sendEvent('Session Ended');
    }

    /**
     * Handle text document changes with per-document debouncing
     * Only sends event after user stops typing for 5 seconds
     */
    private handleTextDocumentChange(document: vscode.TextDocument): void {
        const documentUri = document.uri.toString();
        
        // Clear existing timer for this document
        const existingTimer = this.changeDebounceTimers.get(documentUri);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        
        // Set new timer for this document
        const timer = setTimeout(() => {
            this.sendEvent('onDidChangeTextDocument');
            this.changeDebounceTimers.delete(documentUri);
        }, this.DEBOUNCE_DELAY_MS);
        
        this.changeDebounceTimers.set(documentUri, timer);
    }

    /**
     * Send session event to LMS API
     */
    private sendEvent(eventName: string): void {
        this.apiClient.sendSessionEvent({
            sessionEvent: eventName,
            sessionActiveTime: new Date()
        }).catch(error => {
            // Fail silently but log to console
            console.error(`[SessionTracking] Failed to send event '${eventName}':`, error);
        });
    }

    /**
     * Clean up all listeners and timers
     */
    public dispose(): void {
        console.log('[SessionTracking] Disposing session tracking service...');
        
        // Clear all debounce timers
        this.changeDebounceTimers.forEach(timer => clearTimeout(timer));
        this.changeDebounceTimers.clear();
        
        // Dispose all event listeners
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
        
        console.log('[SessionTracking] Session tracking disposed');
    }
}

