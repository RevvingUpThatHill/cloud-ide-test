const vscode = acquireVsCodeApi();

// Store test states
let testStates = new Map(); // testName -> { state, message, duration, expected, actual, errorType }
let previousTestStates = new Map(); // Store previous run results to detect changes

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
    
    // Store scroll position and find topmost visible test before re-rendering
    let topmostTestName = null;
    let testViewportOffset = 0; // Position relative to viewport top (stays constant after render)
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    
    console.log(`Current scroll position: ${scrollTop}px`);
    
    // Find which test is currently at the top of the viewport
    const testItems = resultsEl.querySelectorAll('.test-item');
    for (const item of testItems) {
        const rect = item.getBoundingClientRect();
        // Check if this test is visible in viewport (accounting for sticky header ~60px)
        if (rect.top >= 50 && rect.top <= window.innerHeight) {
            const nameEl = item.querySelector('.test-name');
            if (nameEl) {
                topmostTestName = nameEl.textContent;
                // Store viewport position (distance from top of viewport)
                testViewportOffset = rect.top;
                console.log(`Found topmost visible test: "${topmostTestName}" at viewport offset ${testViewportOffset}px`);
                break;
            }
        }
    }
    
    if (!topmostTestName && testItems.length > 0) {
        // Fallback: use first test if nothing found
        const firstNameEl = testItems[0].querySelector('.test-name');
        if (firstNameEl) {
            topmostTestName = firstNameEl.textContent;
            const firstRect = testItems[0].getBoundingClientRect();
            testViewportOffset = firstRect.top;
            console.log(`Using fallback: first test "${topmostTestName}" at viewport offset ${testViewportOffset}px`);
        }
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
        const displayState = test.state || 'not run';
        
        // Check if status changed from previous run
        let flashClass = '';
        const previousTest = previousTestStates.get(name);
        if (previousTest) {
            console.log(`Comparing "${name}": previous="${previousTest.state}" current="${test.state}"`);
            if (previousTest.state !== test.state) {
                // Status changed
                if ((previousTest.state === 'failed' || previousTest.state === 'not-run') && test.state === 'passed') {
                    flashClass = 'status-improved';
                    console.log(`✓ Test "${name}" improved: ${previousTest.state} → passed (FLASHING GREEN)`);
                } else if ((previousTest.state === 'passed' || previousTest.state === 'not-run') && test.state === 'failed') {
                    flashClass = 'status-regressed';
                    console.log(`✗ Test "${name}" regressed: ${previousTest.state} → failed (FLASHING RED)`);
                } else {
                    console.log(`  Status changed but no flash: ${previousTest.state} → ${test.state}`);
                }
            }
        } else {
            console.log(`No previous state for "${name}"`);
        }
        
        console.log(`Rendering test "${name}" with state "${test.state}" (class: test-${stateClass} ${flashClass})`);
        html += `
            <div class="test-item test-${stateClass} ${flashClass}">
                <div class="test-name">${escapeHtml(name)}</div>
                <div class="test-status">${displayState}</div>
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
    
    // Restore scroll position to maintain same viewport offset for target test
    if (topmostTestName) {
        console.log(`Attempting to restore: "${topmostTestName}" should be at viewport offset ${testViewportOffset}px`);
        
        // Use requestAnimationFrame twice to ensure DOM is fully rendered
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const testItems = resultsEl.querySelectorAll('.test-item');
                console.log(`Found ${testItems.length} test items after render`);
                
                for (const item of testItems) {
                    const nameEl = item.querySelector('.test-name');
                    if (nameEl && nameEl.textContent === topmostTestName) {
                        // Find where the test is now in the viewport
                        const rect = item.getBoundingClientRect();
                        const currentScrollTop = window.scrollY || document.documentElement.scrollTop;
                        
                        // Calculate scroll needed to put test at same viewport offset
                        // If test should be at viewport 176px, and it's currently at viewport 50px,
                        // we need to scroll up by (50 - 176) = -126px
                        const scrollDelta = rect.top - testViewportOffset;
                        const targetScrollTop = currentScrollTop + scrollDelta;
                        
                        console.log(`Test "${topmostTestName}" is at viewport ${rect.top}px, target viewport ${testViewportOffset}px`);
                        console.log(`Setting scroll to ${targetScrollTop}px (current: ${currentScrollTop}px, delta: ${scrollDelta}px)`);
                        
                        window.scrollTo({
                            top: targetScrollTop,
                            behavior: 'instant'
                        });
                        
                        // Verify
                        setTimeout(() => {
                            const finalScrollTop = window.scrollY || document.documentElement.scrollTop;
                            const finalRect = item.getBoundingClientRect();
                            console.log(`✓ Scroll restored: ${finalScrollTop}px, test now at viewport ${finalRect.top}px (target was ${testViewportOffset}px, diff: ${Math.abs(finalRect.top - testViewportOffset).toFixed(2)}px)`);
                        }, 0);
                        break;
                    }
                }
            });
        });
    }
}

function renderResults(results, workspaceType) {
    // Update test states based on results
    console.log('=== RESULTS RECEIVED ===');
    console.log('Number of results:', results.tests.length);
    console.log('Discovered test names:', Array.from(testStates.keys()));
    console.log('Result test names:', results.tests.map(t => t.name));
    
    results.tests.forEach(test => {
        console.log(`Processing result: "${test.name}" -> status: "${test.status}"`);
        
        // Try to find matching test in discovered tests
        let matchedKey = null;
        testStates.forEach((value, key) => {
            if (key === test.name) {
                matchedKey = key;
            }
        });
        
        if (matchedKey) {
            console.log(`✓ MATCHED: "${test.name}" found in discovered tests`);
            const state = testStates.get(matchedKey);
            state.state = test.status;
            state.duration = test.duration;
            state.message = test.message;
            state.expected = test.expected;
            state.actual = test.actual;
            state.errorType = test.errorType;
            testStates.set(matchedKey, state);
            console.log(`  Updated state to:`, state);
        } else {
            console.log(`✗ NOT MATCHED: "${test.name}" NOT found in discovered tests`);
            // Add it anyway
            testStates.set(test.name, {
                state: test.status,
                duration: test.duration,
                message: test.message,
                expected: test.expected,
                actual: test.actual,
                errorType: test.errorType
            });
        }
    });
    
    console.log('=== FINAL TEST STATES ===');
    testStates.forEach((value, key) => {
        console.log(`  "${key}": state="${value.state}"`);
    });
    
    renderTests();
    
    // Store current states as previous states for next run
    previousTestStates = new Map();
    testStates.forEach((value, key) => {
        previousTestStates.set(key, { state: value.state });
    });
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
            
            // Save initial "not-run" state so first test run can flash
            previousTestStates = new Map();
            testStates.forEach((value, key) => {
                previousTestStates.set(key, { state: value.state });
            });
            
            // Save state
            vscode.setState({
                testStates: Array.from(testStates.entries()),
                previousTestStates: Array.from(previousTestStates.entries())
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
            hideStatus(); // Don't show status message while running
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
                previousTestStates: Array.from(previousTestStates.entries()),
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
        if (previousState.previousTestStates) {
            // Restore previous test states for change detection
            previousTestStates = new Map(previousState.previousTestStates);
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

