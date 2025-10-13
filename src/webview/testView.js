const vscode = acquireVsCodeApi();

function runTests() {
    vscode.postMessage({ type: 'runTests' });
}

function showStatus(message, type) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    statusEl.style.display = 'block';
}

function hideStatus() {
    document.getElementById('status').style.display = 'none';
}

function renderResults(results, workspaceType) {
    const resultsEl = document.getElementById('results');
    
    if (!results || results.tests.length === 0) {
        resultsEl.innerHTML = '<div class="no-results">No tests found</div>';
        return;
    }
    
    const passed = results.tests.filter(t => t.status === 'passed').length;
    const failed = results.tests.filter(t => t.status === 'failed').length;
    const skipped = results.tests.filter(t => t.status === 'skipped').length;
    const total = results.tests.length;
    
    let html = `
        <div class="test-summary">
            <div class="section-title">Test Summary</div>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-value">${total}</span>
                    <span class="stat-label">Total</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color: var(--vscode-testing-iconPassed);">${passed}</span>
                    <span class="stat-label">Passed</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color: var(--vscode-testing-iconFailed);">${failed}</span>
                    <span class="stat-label">Failed</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color: var(--vscode-testing-iconSkipped);">${skipped}</span>
                    <span class="stat-label">Skipped</span>
                </div>
            </div>
        </div>
    `;
    
    results.tests.forEach(test => {
        html += `
            <div class="test-item ${test.status}">
                <div class="test-name">${escapeHtml(test.name)}</div>
                <div class="test-status">${test.status}</div>
                ${test.duration ? `<div class="test-status">Duration: ${test.duration}ms</div>` : ''}
                ${test.message ? `<div class="test-details">
                    <span class="label">Message</span>
                    <div class="value">${escapeHtml(test.message)}</div>
                </div>` : ''}
                ${test.expected ? `<div class="test-details">
                    <span class="label">Expected</span>
                    <div class="value">${escapeHtml(test.expected)}</div>
                    <span class="label">Actual</span>
                    <div class="value">${escapeHtml(test.actual || 'N/A')}</div>
                </div>` : ''}
            </div>
        `;
    });
    
    resultsEl.innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    const button = document.getElementById('runTestsBtn');
    
    switch (message.type) {
        case 'configError':
            button.disabled = true;
            const resultsEl = document.getElementById('results');
            resultsEl.innerHTML = `<div class="no-results">${escapeHtml(message.error)}</div>`;
            break;
            
        case 'testRunning':
            button.disabled = true;
            showStatus('Running tests...', 'running');
            document.getElementById('results').innerHTML = '';
            break;
            
        case 'testResults':
            button.disabled = false;
            const totalTests = message.results.tests.length;
            const failedTests = message.results.tests.filter(t => t.status === 'failed').length;
            
            if (failedTests === 0) {
                showStatus(`Tests completed successfully! (${totalTests} tests)`, 'success');
            } else {
                showStatus(`Tests completed with ${failedTests} failure(s)`, 'error');
            }
            
            renderResults(message.results, message.workspaceType);
            break;
            
        case 'testError':
            button.disabled = false;
            showStatus('Error: ' + message.error, 'error');
            break;
    }
});

