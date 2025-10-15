const vscode = acquireVsCodeApi();

// Store test states
let testStates = new Map(); // testName -> { state, message, duration, expected, actual, errorType }

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

function renderTests() {
    const resultsEl = document.getElementById('results');
    
    if (testStates.size === 0) {
        resultsEl.innerHTML = '<div class="no-results">No tests discovered</div>';
        return;
    }
    
    // Calculate stats
    const total = testStates.size;
    const notRun = Array.from(testStates.values()).filter(t => t.state === 'not-run').length;
    const running = Array.from(testStates.values()).filter(t => t.state === 'running').length;
    const passed = Array.from(testStates.values()).filter(t => t.state === 'passed').length;
    const failed = Array.from(testStates.values()).filter(t => t.state === 'failed').length;
    const error = Array.from(testStates.values()).filter(t => t.state === 'error').length;
    const skipped = Array.from(testStates.values()).filter(t => t.state === 'skipped').length;
    
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
                    <span class="stat-value" style="color: #a65e2b;">${error}</span>
                    <span class="stat-label">Errors</span>
                </div>
            </div>
        </div>
    `;
    
    testStates.forEach((test, name) => {
        const stateClass = test.state || 'not-run';
        console.log(`Rendering test "${name}" with state "${test.state}" (class: test-${stateClass})`);
        html += `
            <div class="test-item test-${stateClass}">
                <div class="test-name">${escapeHtml(name)}</div>
                <div class="test-status">${test.state || 'not run'}</div>
                ${test.duration ? `<div class="test-duration">Duration: ${test.duration}ms</div>` : ''}
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

function renderResults(results, workspaceType) {
    // Update test states based on results
    console.log('Updating test states with results:', results.tests.length, 'tests');
    console.log('Current test states:', Array.from(testStates.keys()));
    console.log('Result test names:', results.tests.map(t => t.name));
    
    results.tests.forEach(test => {
        const state = testStates.get(test.name) || {};
        console.log(`Updating test "${test.name}" with status "${test.status}"`);
        state.state = test.status;
        state.duration = test.duration;
        state.message = test.message;
        state.expected = test.expected;
        state.actual = test.actual;
        state.errorType = test.errorType;
        testStates.set(test.name, state);
    });
    
    console.log('Updated test states:', Array.from(testStates.entries()));
    renderTests();
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
        case 'testsDiscovered':
            // Initialize test states with discovered tests
            testStates.clear();
            message.tests.forEach(test => {
                testStates.set(test.name, {
                    state: test.state,
                    filePath: test.filePath
                });
            });
            renderTests();
            // Save state
            vscode.setState({
                testStates: Array.from(testStates.entries())
            });
            break;
            
        case 'configWarning':
            showStatus('⚠️ ' + message.warning, 'warning');
            // Save state
            vscode.setState({
                ...vscode.getState(),
                status: { message: '⚠️ ' + message.warning, type: 'warning' }
            });
            break;
            
        case 'configError':
            button.disabled = true;
            const resultsEl = document.getElementById('results');
            resultsEl.innerHTML = `<div class="no-results">${escapeHtml(message.error)}</div>`;
            // Save state
            vscode.setState({
                status: { message: 'Configuration error', type: 'error' },
                error: message.error
            });
            break;
            
        case 'testRunning':
            button.disabled = true;
            showStatus('Running tests...', 'running');
            // Set all tests to running state
            testStates.forEach((test, name) => {
                test.state = 'running';
            });
            renderTests();
            break;
            
        case 'testResults':
            button.disabled = false;
            hideStatus();
            renderResults(message.results, message.workspaceType);
            
            // Save state for persistence
            vscode.setState({
                testStates: Array.from(testStates.entries()),
                workspaceType: message.workspaceType
            });
            break;
            
        case 'testError':
            button.disabled = false;
            const errorMessage = 'Error: ' + message.error;
            showStatus(errorMessage, 'error');
            // Save state
            vscode.setState({
                ...vscode.getState(),
                status: { message: errorMessage, type: 'error' }
            });
            break;
    }
});

// Restore previous state when webview is reopened
window.addEventListener('DOMContentLoaded', () => {
    const previousState = vscode.getState();
    if (previousState) {
        if (previousState.testStates) {
            // Restore test states from saved array
            testStates = new Map(previousState.testStates);
            renderTests();
        }
        // Only show status if it's a warning or error, not from completed tests
        if (previousState.status && (previousState.status.type === 'warning' || previousState.status.type === 'error')) {
            showStatus(previousState.status.message, previousState.status.type);
        }
        if (previousState.error) {
            const button = document.getElementById('runTestsBtn');
            button.disabled = true;
            const resultsEl = document.getElementById('results');
            resultsEl.innerHTML = `<div class="no-results">${escapeHtml(previousState.error)}</div>`;
        }
    }
});

