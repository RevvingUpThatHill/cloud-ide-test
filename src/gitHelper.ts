/**
 * Git helper utilities for automatic commit and push
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Commit and push changes with test results in the commit message
 * Only commits and pushes if ALL tests passed (failedTests === 0)
 */
export async function commitAndPushTestResults(
    workspaceRoot: string,
    totalTests: number,
    passedTests: number,
    failedTests: number,
    skippedTests: number
): Promise<void> {
    try {
        // Only commit and push if ALL non-skipped tests passed
        // This elegantly handles both failed and errored tests
        const nonSkippedTests = totalTests - skippedTests;
        if (passedTests < nonSkippedTests || failedTests > 0) {
            console.log(`Skipping git commit/push: Not all tests passed (${passedTests}/${nonSkippedTests} passed, ${failedTests} failed)`);
            return;
        }
        
        // Create timestamp
        const timestamp = new Date().toISOString();
        
        // Create commit message with test results
        const commitMessage = `Test run: ${passedTests}/${totalTests} passed, ${failedTests} failed, ${skippedTests} skipped - ${timestamp}`;
        
        // Stage all changes
        await execAsync('git add .', { cwd: workspaceRoot });
        
        // Check if there are changes to commit
        const statusResult = await execAsync('git status --porcelain', { cwd: workspaceRoot });
        if (!statusResult.stdout.trim()) {
            console.log('No changes to commit');
            return;
        }
        
        // Commit with test results message
        await execAsync(`git commit -m "${commitMessage}"`, { cwd: workspaceRoot });
        console.log(`Committed: ${commitMessage}`);
        
        // Push to remote
        await execAsync('git push', { cwd: workspaceRoot });
        console.log('Pushed changes to remote');
        
        // Show success notification
        vscode.window.showInformationMessage(
            `Git: Committed and pushed test results (${passedTests}/${totalTests} passed)`
        );
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Git commit/push failed:', errorMessage);
        
        // Show error notification (but don't block test execution)
        vscode.window.showWarningMessage(
            `Git commit/push failed: ${errorMessage.split('\n')[0]}`
        );
    }
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

