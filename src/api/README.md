# LMS API Client Architecture

This directory contains the LMS (Learning Management System) API client implementation that supports multiple backends (Evolv and Revature).

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│         Application Layer                    │
│  (testViewProvider.ts, extension.ts)        │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│      apiClientFactory.ts                     │
│  (Routes to correct implementation)          │
└─────────────────┬───────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
┌───────▼──────┐    ┌──────▼────────┐
│ EvolvApiClient│    │RevatureApiClient│
│(evolvtalent.ai)│    │(revature.com) │
└───────────────┘    └───────────────┘
        │                   │
        └─────────┬─────────┘
                  │
        ┌─────────▼─────────┐
        │ LMSApiClient      │
        │  (Interface)      │
        └───────────────────┘
```

## Files

### Core Files

- **`lmsClient.interface.ts`** - Common interface that all LMS clients must implement
- **`apiClientFactory.ts`** - Factory that creates the correct client based on `API_BASE_URL`
- **`evolvApiClient.ts`** - Evolv LMS implementation (evolvtalent.ai)
- **`revatureApiClient.ts`** - Revature LMS implementation (revature.com)

## Usage

### Getting the API Client

```typescript
import { getApiClient } from './api/apiClientFactory';

const apiClient = getApiClient();
```

The factory automatically routes to the correct implementation based on the `API_BASE_URL` in `.revature` config:
- Contains `evolvtalent.ai` → Uses `EvolvApiClient`
- Contains `revature.com` → Uses `RevatureApiClient`

### Sending Test Results

```typescript
import { TestExecutionData } from './api/lmsClient.interface';

const testData: TestExecutionData = {
    totalTests: 10,
    passedTests: 8,
    failedTests: 2,
    erroredTests: 0,
    skippedTests: 0,
    testCaseMessage: "Tests run: 10, Passed: 8, Failed: 2, Errored: 0, Skipped: 0"
};

await apiClient.sendTestResults(workspaceLocation, testData);
```

### Sending Session Events

```typescript
await apiClient.sendSessionEvent({
    sessionEvent: 'Session Started',
    sessionActiveTime: new Date()
});
```

#### Tracked Session Events (Both APIs)

The extension automatically tracks the following events for both Evolv and Revature APIs:

**Session Events:**
- `Session Started` - When extension activates
- `Session Ended` - When extension deactivates (best effort - may not fire on browser tab close)

**File Operations:**
- `onDidSaveTextDocument` - When a file is saved
- `onDidChangeTextDocument` - When text changes (debounced 5 seconds per document)
- `onDidCreateFiles` - When files are created
- `onDidDeleteFiles` - When files are deleted
- `onDidRenameFiles` - When files are renamed

**Debug Operations:**
- `onDidStartDebugSession` - When debugging starts
- `onDidTerminateDebugSession` - When debugging ends
- `onDidChangeBreakpoints` - When breakpoints are added/removed/modified

**Implementation:** See `src/sessionTracking.ts` for details.

## Implementation Differences

### Evolv API Client (`evolvApiClient.ts`)

**Endpoints:**
- `/learning/api/v1/unsecure/cloud-lab/execution-record` - Test results
- `/learning/api/v1/unsecure/cloud-lab/session-data` - Session events

**Flow:**
1. Send test results to API
2. Git commit/push handled separately (in `gitHelper.ts`)

**Headers:**
- `x-api-key: <API_KEY>`
- `Content-Type: application/json`

**Configuration (.revature file):**
```bash
CLOUD_LAB_WORKSPACE_ID="..."
LEARNER_CURRICULUM_ACTIVITY_ID="..."
ACTIVITY_TYPE="..."
API_KEY="..."
API_BASE_URL="https://dev-api.evolvtalent.ai"
```

### Revature API Client (`revatureApiClient.ts`)

**Endpoints:**
1. `/apigateway/associates/secure/cloud-lab/session-details` - Session tracking
2. `/apigateway/associates/secure/cloud-lab/commit-details` - Commit + test data (POST)
3. `/apigateway/associates/secure/cloud-lab/commit-status` - Status update (PATCH)

**Flow (for test results):**
1. **Commit** changes with test results message
2. **Capture metadata** (commit hash, stats, author, etc.)
3. **Generate test case file** in Revature format
4. **Send commit-details** with test data to API
5. **Send commit-status** update to API
6. **Push to remote** (only if all API calls succeed)

**Headers:**
- `cloudlab-api-access-key: <API_KEY>` (different from Evolv!)
- `Content-Type: application/json`

**Configuration (.revature file):**
```bash
REVPRO_WORKSPACE_ID="2401"
PROJECT_TYPE="PT002"  # Used as projectCode
TRAINEE_CODING_LAB_ID="..."
INTERN_ID="..."
GITPOD_WORKSPACE_CONTEXT_URL="..."
REPO_URL="https://github.com/user/repo"
GIT_USERNAME="user"
API_KEY="cAd6735gASdfrgdWfdASFUcer8763"
API_BASE_URL="https://qa-ms.revature.com/"
```

### Test Case File Format (Revature Only)

Revature API expects test results in a custom format:

```
%TESTE  1,testName(ClassName),%RUNTIME15,PASS
%TESTE  2,testName2(ClassName),%RUNTIME20,FAIL
%TESTE  3,testName3(ClassName),%RUNTIME10,PASS
```

Format specification:
- `%TESTE  {num}` - Test number (2 spaces after TESTE)
- `{testName}({ClassName})` - Test method name with class in parentheses
- `%RUNTIME{ms}` - Execution time in milliseconds
- `PASS` or `FAIL` - Test result (errors/skipped count as FAIL)

This is generated by `utils/testCaseFileGenerator.ts` and sent as a byte array in the API payload.

## Git Integration

### Evolv Flow (Separate Git Operations)

```
Run Tests → Send to API
              ↓
         Git Commit → Git Push
```

Git operations are handled in `gitHelper.ts` and run independently of API calls.

### Revature Flow (Integrated Git + API)

```
Run Tests → Commit → Capture Metadata → Send to API → Push
```

All git operations are integrated into the API client (`git/gitCommitService.ts`):
1. Commit is made BEFORE API call
2. Commit metadata is captured (hash, stats, etc.)
3. Metadata is sent to API
4. Push happens ONLY if API call succeeds

This ensures the API always has accurate commit information.

## Supporting Services

### Git Commit Service (`git/gitCommitService.ts`)

Handles git operations for Revature API:

```typescript
import { commitAndCaptureMetadata, pushToRemote } from './git/gitCommitService';

// Commit and get metadata
const metadata = await commitAndCaptureMetadata(workspaceRoot, commitMessage);
// Returns: { commitSha, commitMessage, commitTime, gitUserName, repositoryUrl, 
//            filesChanged, insertions, deletions, lineCount }

// Push (only after successful API call)
await pushToRemote(workspaceRoot);
```

### Test Case File Generator (`utils/testCaseFileGenerator.ts`)

Generates Revature format test case files:

```typescript
import { generateTestCaseFile } from './utils/testCaseFileGenerator';

const testCases = [
    { name: 'testAdd', status: 'passed', duration: 15 },
    { name: 'testSubtract', status: 'failed', duration: 20 }
];

const { content, byteArray } = generateTestCaseFile(testCases);
// content: Human-readable string (logged to console)
// byteArray: Byte array for API payload
```

## Future Enhancements

### Git Hooks Support (Revature)

The `viaCommitted` flag in the Revature API payload is currently set to `false`. 

**Future implementation:**
- When git hooks are added (similar to the post-commit hook in the setup script)
- Set `viaCommitted: true` when tests are triggered by git commit hooks
- Set `viaCommitted: false` when tests are run manually via the extension

**Comment in code:**
```typescript
// TODO: Set to true when git hooks trigger tests (future enhancement)
// Currently false since tests are manually triggered by the extension
viaCommitted: false
```

## Testing

To test with different APIs:

1. **Test with Evolv API:**
   ```bash
   # In .revature file
   API_BASE_URL="https://dev-api.evolvtalent.ai"
   ```

2. **Test with Revature API:**
   ```bash
   # In .revature file
   API_BASE_URL="https://qa-ms.revature.com/"
   ```

The factory will automatically route to the correct implementation.

## Error Handling

Both clients handle errors gracefully:
- API failures are logged but don't block test execution
- Git failures (Revature) are logged and prevent API calls/push
- Missing configuration fields result in warnings but don't crash

All errors are logged with `[ClientName]` prefixes for easy debugging:
- `[EvolvApiClient]`
- `[RevatureApiClient]`
- `[ApiClientFactory]`
- `[Git]`
- `[TestCaseFile]`

