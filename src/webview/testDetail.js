const vscode = acquireVsCodeApi();

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.type) {
        case 'showTestDetails':
            displayTestDetails(message.test, message.command);
            break;
    }
});

function displayTestDetails(test, command) {
    const testNameEl = document.getElementById('testName');
    const contentEl = document.getElementById('content');
    
    testNameEl.textContent = test.name;
    
    let html = '';
    
    // Status section
    const statusClass = `status-${test.state}`;
    html += `<div class="detail-section">
        <h3>Status</h3>
        <div class="status-badge ${statusClass}">${test.state}</div>
    </div>`;
    
    // Basic info grid
    if (test.duration || test.filePath) {
        html += `<div class="detail-section">
            <h3>Test Information</h3>
            <div class="info-grid">`;
        
        if (test.duration) {
            html += `
                <div class="info-label">Duration:</div>
                <div class="info-value">${test.duration}ms</div>`;
        }
        
        if (test.filePath) {
            html += `
                <div class="info-label">File:</div>
                <div class="info-value">${escapeHtml(test.filePath)}</div>`;
        }
        
        html += `</div></div>`;
    }
    
    // Message
    if (test.message) {
        html += `<div class="detail-section">
            <h3>Message</h3>
            <pre>${escapeHtml(test.message)}</pre>
        </div>`;
    }
    
    // Expected/Actual
    if (test.expected) {
        html += `<div class="detail-section">
            <h3>Expected Value</h3>
            <pre>${escapeHtml(test.expected)}</pre>
        </div>`;
        
        if (test.actual) {
            html += `<div class="detail-section">
                <h3>Actual Value</h3>
                <pre>${escapeHtml(test.actual)}</pre>
            </div>`;
        }
    }
    
    // Full output (stack trace)
    if (test.fullOutput) {
        html += `<div class="detail-section">
            <h3>Full Test Output</h3>
            <pre>${escapeHtml(test.fullOutput)}</pre>
        </div>`;
    }
    
    // Command section
    if (command) {
        html += `<div class="detail-section">
            <h3>Test Command</h3>
            <p style="margin: 0 0 8px 0; font-size: 11px; opacity: 0.7;">You can run the tests manually in your terminal using this command:</p>
            <div class="command-box">${escapeHtml(command)}</div>
        </div>`;
    }
    
    contentEl.innerHTML = html;
}

// Notify extension that webview is ready
document.addEventListener('DOMContentLoaded', () => {
    vscode.postMessage({ type: 'detailPanelReady' });
});

