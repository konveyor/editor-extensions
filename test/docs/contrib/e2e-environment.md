## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running Tests](#running-tests)
- [Code Formatting](#code-formatting)
- [Writing a New Test Suite](#writing-a-new-test-suite)

## Prerequisites

Before you begin, ensure you have the following:

    Node.js (version 20 or later) installed.
    Visual Studio Code installed on your system.

## Installation

1. **Clone the Repository**

        git clone https://github.com/konveyor/kai-ci
        cd kai-ci

2. **Install Dependencies**

   Install the required packages with `npm install`

## Configuration

Create an .env file by copying the content of [.env.example](../../.env.example) and replace the properties values with
yours.

The editor extension gets a new development build each night, you can configure the extension's download url and name
automatically by executing `node scripts/set-latest-vsix-env.mjs`

## Running Tests

To run all the automated tests, use the following command:

`npm run test`

This command will execute all tests in the repository. To run a specific test file:

`npx playwright test vscode.test.ts`

## Code formatting

Code is automatically formatted on pre-commit, but you can also do it manually with the following commands

1. Format code `npm run format`

2. Check formatting `npm run check`

## Writing a New Test Suite

Before starting please note:

* **Tests run sequentially**: Parallelization is disabled to allow shared state and avoid repeated time-demanding VS
  Code
  setups.
* **Test dependencies**: Use projects in `playwright.config.ts` to define dependencies between test suites.
* **Global setup**: The `global-setup.ts` is executed before every other test suite, it is the responsible for
  installing the extension.
* **Fixtures**: Under [fixtures](../../e2e/fixtures) you may find repositories and configurations that are shared among
  all tests

To add a new test suite create a new test file inside [tests](../../e2e/tests), with `.test.ts` extension

### VSCode Page Object Model

The [vscode.pages.ts](../../e2e/pages/vscode.pages.ts) file represents a VS Code instance and contains the functions
shared across multiple tests. It extends from [application.pages.ts](../../e2e/pages/application.pages.ts) which should
contain more generic functions.

### Known Issues & Warnings

Windows runs slower: Some tests include waitForTimeout() calls to avoid race conditions. Test on Linux when possible.

Playwright + Electron is experimental, meaning some DOM features differ or are unsupported from the web version
Use the feature/sl-latest-nightly branch: Most active development happens there. main is outdated.
