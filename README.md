# Cloud IDE Test Extension

A multi-language testing extension for Visual Studio Code that supports Java (Maven/JUnit), Angular (Jasmine/Karma), and Python (unittest).

## Features

- **Multi-Language Support**: Automatically detects workspace type and runs appropriate tests
  - Java: Maven + JUnit
  - Angular: Jasmine + Karma
  - Python: unittest

- **Unified Test Interface**: Consistent webview UI across all language types

- **Detailed Test Results**: View test outcomes with:
  - Pass/Fail/Skip status
  - Test duration
  - Failure messages
  - Expected vs Actual values for failed assertions

- **Sidebar Integration**: Easy access via dedicated Activity Bar icon

## Usage

### Setup

1. Create a `.lab.json` file in your workspace root with the following content:

   ```json
   {
     "workspaceType": "Java"
   }
   ```

   Valid values for `workspaceType`:
   - `"Java"` - For Java/Maven projects with JUnit tests
   - `"Angular"` - For Angular projects with Jasmine/Karma tests
   - `"Python"` - For Python projects with unittest tests

   **Note**: If `.lab.json` is not found or invalid, the extension will default to Python and display a warning.

2. (Optional) Set environment variables for telemetry:
   - `TELEMETRY_AI_KEY`: Application Insights instrumentation key
     - Windows: `set TELEMETRY_AI_KEY=your-key-here`
     - Linux/Mac: `export TELEMETRY_AI_KEY=your-key-here`
   
   - `TELEMETRY_ENDPOINT`: Custom telemetry endpoint URL (defaults to Azure Application Insights)
     - Windows: `set TELEMETRY_ENDPOINT=https://your-endpoint.com/v2/track`
     - Linux/Mac: `export TELEMETRY_ENDPOINT=https://your-endpoint.com/v2/track`

3. Open your project in VS Code

4. Click on the Cloud IDE Test icon in the Activity Bar (left sidebar)

### Running Tests

1. Open the test view from the sidebar
2. Click the "Run Tests" button
3. View results in the webview panel

## Requirements

### Java Projects
- Maven installed and available in PATH
- JUnit tests configured in pom.xml

### Angular Projects
- Node.js and npm installed
- Jasmine/Karma configured
- `test` script in package.json

### Python Projects
- Python 3 installed and available in PATH
- Tests following unittest conventions
- Optional: pytest for enhanced reporting

## Extension Settings

This extension uses a combination of configuration file and environment variables:

### Configuration File (.lab.json)

Place a `.lab.json` file in your workspace root with the following structure:

```json
{
  "workspaceType": "Java"
}
```

- **workspaceType** (optional, defaults to `Python`): Determines which test framework to use
  - Valid values: `"Java"`, `"Angular"`, or `"Python"`

### Environment Variables

- **TELEMETRY_AI_KEY** (optional): Azure Application Insights instrumentation key for telemetry
- **TELEMETRY_ENDPOINT** (optional): Custom telemetry endpoint URL

The extension will activate successfully even if `.lab.json` is not found. It will default to Python and display a warning message in the webview.

## Development

To run this extension in development mode:

1. Install dependencies: `npm install`
2. Open in VS Code
3. Press F5 to open a new window with the extension loaded
4. In the test project, create a `.lab.json` file with your desired workspace type
5. Open a test project and try the extension

## Building

To build the extension:

```bash
npm install
npm run compile
```

To package the extension:

```bash
npm install -g @vscode/vsce
vsce package
```

## License

MIT

