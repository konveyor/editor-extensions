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

Install the required packages with `cd tests && npm install`

## Strategy

These suite uses Playwright to interact with the VSCode extension as a user would.

It ensures that:

- The extension works as expected after installation.
- Integration with GenAI providers is functional.
- Feature workflows (e.g. analysis, managing profiles, requesting solutions) behave correctly.

Since VSCode behavior differs significantly in headless mode, tests are expected to run with the UI
visible in CI. It may work in headless mode in certain environments, but this is considered an edge
case rather than a design decision. Additionally, headless mode does not work on Windows at all.

## Architecture

These tests use the Page Object Model pattern, in this case,
the [vscode.page.ts](../../e2e/pages/vscode.page.ts) represents the VSCode instance currently
running and should contain the methods for interacting with VSCode and the extension. This model
extends from [application.page.ts](../../e2e/pages/application.page.ts), which contain more
generic methods like copying/pasting.

All static data that a test uses should be under [fixtures](../../e2e/fixtures), as of now, there
are repositories and configurations that are shared among all tests

### Tests run sequentially

In a usual setup, tests would [run in parallel](https://playwright.dev/docs/test-parallel), however
in this case parallelization is explicitly disabled to allow shared state and avoid repeated
time-demanding VS Code setups and analyses, it also prevents multiple tests to collide when editing
common files like genAI provider settings or binaries paths.

### Dependencies

Dependencies are defined by [projects](https://playwright.dev/docs/test-projects)
in [playwright.config.ts](../../playwright.config.ts). The [global.setup.ts](../../global.setup.ts)
file contains a function that will run before every other test suite, it contains the extension
installation and the configuration of the GenAI provider settings that allows to verify that the
extension was successfully installed. If this setup fails the tests won't run.

## Configuration

Create an .env file by copying the content of [.env.example](../../.env.example) and replace the
properties values with
yours.

Additionally, you can directly pass the env variables.

| KEY                    | DESCRIPTION                                                                                                                                                                                                                                                |
|------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| VSCODE_EXECUTABLE_PATH | Path to executable vscode                                                                                                                                                                                                                                  |
| VSIX_FILE_PATH         | (Optional) Path to the extension in vsix format. <br/>If this property and VSIX_DOWNLOAD_URL are not set, the tests will run using the local extension under development (launches VS Code with `--extensionDevelopmentPath` and `--enable-proposed-api`). |
| VSIX_DOWNLOAD_URL      | (Optional) URL to get vsix from (only used if VSIX_FILE_PATH is not defined)                                                                                                                                                                               |
| OPENAI_API_KEY         | OPENAI API KEY FOR GenAI provider                                                                                                                                                                                                                          |
| KAI_QE_S3_BUCKET_NAME  | (Optional) AWS S3 bucket name (only needed if running evaluation)                                                                                                                                                                                          |
| PARASOL_API_KEY        | (Optional) API key for MaaS provider (Only used if working with https://maas.apps.prod.rhoai.rh-aiservices-bu.com/)                                                                                                                                        |
| UPDATE_LLM_CACHE       | (Optional) When set to true, the offline tests will run in online mode and generate new cached data for the configured provider. Will require provider credentials to run.                                                                                 |
| ANALYZER_BINARY_PATH   | (Optional) Absolute path used by [custom-binary-analysis.test.ts](../../e2e/tests/base/custom-binary-analysis.test.ts) to define a custom path for the analyzer binary                                                                                     |
| TEST_REPO_URL          | (Optional) Default is <https://github.com/konveyor-ecosystem/coolstore>                                                                                                                                                                                    |
| TEST_REPO_NAME         | (Optional) Default is `coolstore`                                                                                                                                                                                                                          |
| WEB_ENV                | (Optional, boolean) If set to 1, the tests will run in VSCode in a web environment                                                                                                                                                                         |
| WEB_BASE_URL           | (Required if WEB_ENV is 1) The URL of the VSCode web instance                                                                                                                                                                                              |
| WEB_LOGIN              | (Required if WEB_ENV is 1) The login credentials for the web instance                                                                                                                                                                                      |
| WEB_PASSWORD           | (Required if WEB_ENV is 1) The password for the web instance                                                                                                                                                                                               |
| SOLUTION_SERVER_URL   | URL of the Solution Server instance |
| SOLUTION_SERVER_REALM  | Authentication realm for Solution Server|
| SOLUTION_SERVER_USERNAME   | Username for Solution Server authentication |
| SOLUTION_SERVER_PASSWORD  | Password for Solution Server authentication |

## Running Tests

To run all the automated tests, use the following command:

`npm run test`

This command will execute all tests in the repository. To run a specific test file:

`npx playwright test vscode.test.ts`

## Code formatting

Code is automatically formatted on pre-commit, but you can also do it manually with the following
commands

1. Format code `npm run format`

2. Check formatting `npm run check`

## Writing a New Test Suite

To add a new test suite create a new test file inside [tests](../../e2e/tests), with `.test.ts`
extension.

You need to ensure that your test file name falls into one of the
existing [projects](../../playwright.config.ts) otherwise it won't run,

### Known Issues & Warnings

Windows runs slower: Some tests include waitForTimeout() calls to avoid race conditions. Test on
Linux when possible.

Playwright + Electron is experimental, meaning some DOM features differ or are unsupported from the
web version
