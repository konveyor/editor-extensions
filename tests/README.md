# VSCode Automation with Playwright

This module contains automated tests using Playwright to launch VSCode, install the extension and
perform a series of e2e tests

## Table of Contents

- [Features](#features)
- [Getting Started](#-getting-started)

# Features

Features already automated in this repo:

## General

- Install extension from vsix
- Configure GenAI Provider
- Create and manage analysis profiles
- Start server
- Open and analyze application
- Search for violations
- Fix Issues using default effort
- Accept proposed solutions
- Evaluation: [kai-evaluator](kai-evaluator)

## Solution Server

- [analysis-validation.test.ts](e2e/tests/solution-server/analysis-validation.test.ts)[solution-server-analysis-validation.test.ts](e2e/tests/solution-server/solution-server-analysis-validation.test.ts):
  Tests the process of requesting, accepting, and rejecting solutions, and verifies that the
  solution server's success rate and best hints endpoints are updated accordingly.

# 🚀 Getting Started

To get started, check out the E2E environment setup
guide: [e2e-environment.md](docs/contrib/e2e-environment.md)


