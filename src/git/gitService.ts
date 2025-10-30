/**
 * Unified Git service for all git operations
 * Consolidates functionality from gitHelper.ts and gitCommitService.ts
 * 
 * Provides:
 * - Basic commit and push operations (for Evolv API)
 * - Advanced commit with metadata capture (for Revature API)
 * - Repository validation
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readRevatureConfig } from '../revatureConfig';

const execAsync = promisify(exec);

export interface CommitMetadata {
    commitSha: string;
    commitMessage: string;
    commitTime: string; // ISO 8601 format
    gitUserName: string;
    repositoryUrl: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
    lineCount: number; // Total changes: insertions + deletions
}

/**
 * Check if the workspace is a git repository
 */
export async function isGitRepository(workspaceRoot: string): Promise<boolean> {
    try {
        await execAsync('git rev-parse --git-dir', { cwd: workspaceRoot });
        return true;
    } catch {
        return false;
    }
}

/**
 * Simple commit and push (used by Evolv API flow)
 * Commits all changes with a message and pushes to remote
 */
export async function commitAndPushTestResults(
    workspaceRoot: string,
    totalTests: number,
    passedTests: number,
    failedTests: number,
    skippedTests: number
): Promise<void> {
    try {
        // Create timestamp
        const timestamp = new Date().toISOString();
        
        // Create commit message with test results
        const commitMessage = `Test run: ${passedTests}/${totalTests} passed, ${failedTests} failed, ${skippedTests} skipped - ${timestamp}`;
        
        // Stage all changes
        await execAsync('git add .', { cwd: workspaceRoot });
        
        // Check if there are changes to commit
        const statusResult = await execAsync('git status --porcelain', { cwd: workspaceRoot });
        if (!statusResult.stdout.trim()) {
            console.log('[Git] No changes to commit');
            return;
        }
        
        // Commit with test results message
        await execAsync(`git commit -m "${commitMessage}"`, { cwd: workspaceRoot });
        console.log(`[Git] Committed: ${commitMessage}`);
        
        // Push to remote
        await execAsync('git push', { cwd: workspaceRoot });
        console.log('[Git] Pushed changes to remote');
        
        // Show success notification
        vscode.window.showInformationMessage(
            `Git: Committed and pushed test results (${passedTests}/${totalTests} passed)`
        );
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Git] Commit/push failed:', errorMessage);
        
        // Show error notification (but don't block test execution)
        vscode.window.showWarningMessage(
            `Git commit/push failed: ${errorMessage.split('\n')[0]}`
        );
    }
}

/**
 * Commit changes and capture all metadata (used by Revature API flow)
 * Does NOT push - caller should push after successful API call
 * Returns null if there are no changes to commit
 */
export async function commitAndCaptureMetadata(
    workspaceRoot: string,
    commitMessage: string
): Promise<CommitMetadata | null> {
    try {
        // Stage all changes
        await execAsync('git add .', { cwd: workspaceRoot });
        
        // Check if there are changes to commit
        const statusResult = await execAsync('git status --porcelain', { cwd: workspaceRoot });
        if (!statusResult.stdout.trim()) {
            console.log('[Git] No changes to commit');
            return null;
        }
        
        // Commit with message
        await execAsync(`git commit -m "${commitMessage}"`, { cwd: workspaceRoot });
        console.log(`[Git] Committed: ${commitMessage}`);
        
        // Capture commit metadata
        const metadata = await captureCommitMetadata(workspaceRoot);
        console.log('[Git] Commit metadata captured:', metadata);
        
        return metadata;
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Git] Commit failed:', errorMessage);
        throw new Error(`Git commit failed: ${errorMessage}`);
    }
}

/**
 * Capture metadata from the most recent commit
 * Internal helper for commitAndCaptureMetadata
 */
async function captureCommitMetadata(workspaceRoot: string): Promise<CommitMetadata> {
    try {
        // Get commit hash, author name, author date, and commit message
        // Format: hash|author|date|message
        const logResult = await execAsync(
            'git log -1 --format="%H|%an|%aI|%s"',
            { cwd: workspaceRoot }
        );
        const [commitSha, gitUserName, commitTime, commitMessage] = logResult.stdout.trim().split('|');
        
        // Get repository URL
        let repositoryUrl = '';
        try {
            const remoteResult = await execAsync('git remote get-url origin', { cwd: workspaceRoot });
            repositoryUrl = remoteResult.stdout.trim();
            
            // Clean up the URL if it contains credentials
            // https://user:token@github.com/repo -> https://github.com/repo
            repositoryUrl = repositoryUrl.replace(/https?:\/\/[^@]+@/, 'https://');
        } catch (error) {
            console.warn('[Git] Could not get remote URL:', error);
            // Try to get it from .revature config as fallback
            const config = readRevatureConfig();
            repositoryUrl = config?.REPO_URL || '';
        }
        
        // Get file change statistics (--numstat shows insertions, deletions, filename)
        const statResult = await execAsync(
            'git show --stat --format="" --numstat HEAD',
            { cwd: workspaceRoot }
        );
        
        // Parse numstat output: each line is "insertions\tdeletions\tfilename"
        const lines = statResult.stdout.trim().split('\n').filter(line => line.trim());
        let filesChanged = 0;
        let insertions = 0;
        let deletions = 0;
        
        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length >= 2) {
                const ins = parseInt(parts[0], 10) || 0;
                const del = parseInt(parts[1], 10) || 0;
                
                // Skip binary files (shown as "-" in git)
                if (parts[0] !== '-' && parts[1] !== '-') {
                    insertions += ins;
                    deletions += del;
                    filesChanged++;
                }
            }
        }
        
        const lineCount = insertions + deletions;
        
        return {
            commitSha,
            commitMessage,
            commitTime,
            gitUserName,
            repositoryUrl,
            filesChanged,
            insertions,
            deletions,
            lineCount
        };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Git] Failed to capture commit metadata:', errorMessage);
        throw new Error(`Failed to capture commit metadata: ${errorMessage}`);
    }
}

/**
 * Push commits to remote repository
 * Used by Revature API flow after successful API calls
 */
export async function pushToRemote(workspaceRoot: string): Promise<void> {
    try {
        await execAsync('git push', { cwd: workspaceRoot });
        console.log('[Git] Successfully pushed to remote');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Git] Push failed:', errorMessage);
        throw new Error(`Git push failed: ${errorMessage}`);
    }
}

