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

1. Set the `workspace_type` environment variable to one of: `Java`, `Angular`, or `Python`
   - Windows: `set workspace_type=Java`
   - Linux/Mac: `export workspace_type=Java`

2. Open your project in VS Code

3. Click on the Cloud IDE Test icon in the Activity Bar (left sidebar)

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

This extension reads the `workspace_type` environment variable to determine the test framework to use.

## Development

To run this extension in development mode:

1. Install dependencies: `npm install`
2. Open in VS Code
3. Press F5 to open a new window with the extension loaded
4. Set the `workspace_type` environment variable before launching VS Code
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

