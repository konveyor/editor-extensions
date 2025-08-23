# Solution Server Change Acceptance Tests

This document provides instructions for running the Solution Server change acceptance tests locally.

## Overview

The Solution Server change acceptance tests validate three key scenarios:

1. **Accepting All Changes**: Validates that the system correctly accepts all proposed changes when the user chooses to accept.
2. **Rejecting All Changes**: Validates that the system correctly rejects all proposed changes when the user chooses to reject.
3. **Modifying Results and Accepting Changes**: Validates that the user can modify individual hunks/changes before accepting, and that the system behaves as expected in this scenario.

## Prerequisites

1. **Node.js**: Version 22.9.0 or higher (as specified in `.nvmrc`)
2. **npm**: Version 10.5.2 or higher
3. **Solution Server**: Running and accessible at `http://localhost:8000`
4. **Test Repository**: The tests use the coolstore repository for testing

## Setup Instructions

### 1. Install Dependencies

```bash
# Install main project dependencies
npm install

# Install test dependencies
cd tests
npm install
```

### 2. Install Playwright Browsers

```bash
cd tests
npx playwright install
```

### 3. Environment Configuration

Create a `.env` file in the `tests` directory with the necessary configuration:

```bash
cp .env.example .env
# Edit .env file with your specific configuration
```

## Running the Tests

### Run All Solution Server Tests

```bash
cd tests
npm run test -- --project=solution-server-tests
```

### Run Specific Change Acceptance Tests

```bash
cd tests
npm run test -- tests/solution-server/change-acceptance.test.ts
```

### Run Individual Test Scenarios

```bash
# Accept all changes test
cd tests
npm run test -- tests/solution-server/change-acceptance.test.ts --grep "Accept all changes"

# Reject all changes test
cd tests
npm run test -- tests/solution-server/change-acceptance.test.ts --grep "Reject all changes"

# Modify results and accept changes test
cd tests
npm run test -- tests/solution-server/change-acceptance.test.ts --grep "Modify individual hunks"
```

## Test Configuration

The tests are configured in `playwright.config.ts` under the `solution-server-tests` project:

```typescript
{
  name: 'solution-server-tests',
  testMatch: ['**/solution-server/**/*.test.ts'],
}
```

## Understanding the Tests

### Test Structure

Each test follows this general pattern:

1. **Setup**: Configure VSCode, connect to Solution Server, run analysis
2. **Request Fix**: Search for a specific violation and request a solution
3. **Handle Changes**: Either accept all, reject all, or selectively modify changes
4. **Validate**: Verify that the solution server correctly tracks success rates

### Key Test Components

- **VSCode Page Object**: Handles VSCode interactions
- **MCPClient**: Validates backend behavior and success rates
- **Resolution View**: Tests the UI for accepting/rejecting changes
- **Hunk Selection Interface**: Tests individual change modification

### Selective Change Modification

The "Modify results and accept changes" test specifically validates:

- Individual hunk accept/reject functionality
- Bulk action buttons (Accept All, Reject All, Reset All)
- State management for pending/accepted/rejected hunks
- UI feedback for hunk state changes

## CI Integration

These tests are automatically run in the CI pipeline as part of the `solution-server-tests` project. The tests are configured to:

- Run with a timeout of 120 seconds per test
- Use a single worker to avoid conflicts
- Generate traces and screenshots on failure

## Troubleshooting

### Common Issues

1. **Solution Server Not Running**: Ensure the solution server is accessible at `http://localhost:8000`
2. **Browser Installation**: Run `npx playwright install` if browsers are missing
3. **Timeout Errors**: Increase timeout values in test configuration if needed
4. **Environment Issues**: Verify Node.js version matches `.nvmrc` requirements

### Debug Mode

Run tests in debug mode for troubleshooting:

```bash
cd tests
npx playwright test tests/solution-server/change-acceptance.test.ts --debug
```

### Viewing Test Reports

```bash
cd tests
npx playwright show-report
```

## Test Data

The tests use the `coolstore` repository from the test data fixtures. The specific violation tested is:

- **Rule Set**: `eap8/eap7`
- **Violation**: `javax-to-jakarta-import-00001`
- **Description**: Replace `javax.persistence` import statement with `jakarta.persistence`

## Contributing

When adding new test scenarios:

1. Follow the existing test pattern
2. Update this documentation
3. Ensure tests are idempotent and can run independently
4. Add appropriate assertions for both UI and backend validation