#!/usr/bin/env node

/**
 * Validation script for Solution Server change acceptance tests
 * 
 * This script checks that all prerequisites are met before running the tests.
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOLUTION_SERVER_URL = 'http://localhost:8000';
const REQUIRED_NODE_VERSION = '22.9.0';

async function checkNodeVersion() {
  console.log('🔍 Checking Node.js version...');
  
  try {
    const nodeVersion = process.version.slice(1); // Remove 'v' prefix
    const requiredVersion = REQUIRED_NODE_VERSION;
    
    if (!nodeVersion.startsWith(requiredVersion.split('.')[0])) {
      console.error(`❌ Node.js version ${requiredVersion} or higher required, found ${nodeVersion}`);
      console.error(`   Use: nvm use ${requiredVersion} or n ${requiredVersion}`);
      return false;
    }
    
    console.log(`✅ Node.js version ${nodeVersion} is compatible`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to check Node.js version: ${error.message}`);
    return false;
  }
}

async function checkNpmDependencies() {
  console.log('🔍 Checking npm dependencies...');
  
  try {
    execSync('npm list --depth=0', { stdio: 'pipe', cwd: __dirname });
    console.log('✅ npm dependencies are installed');
    return true;
  } catch (error) {
    console.error('❌ npm dependencies not installed or have issues');
    console.error('   Run: npm install');
    return false;
  }
}

async function checkPlaywrightBrowsers() {
  console.log('🔍 Checking Playwright browsers...');
  
  try {
    execSync('npx playwright install --dry-run', { stdio: 'pipe', cwd: __dirname });
    console.log('✅ Playwright browsers are installed');
    return true;
  } catch (error) {
    console.error('❌ Playwright browsers not installed');
    console.error('   Run: npx playwright install');
    return false;
  }
}

async function checkSolutionServer() {
  console.log('🔍 Checking Solution Server availability...');
  
  try {
    // Use node's built-in fetch (available in Node 18+)
    const response = await fetch(`${SOLUTION_SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    
    if (response.ok) {
      console.log(`✅ Solution Server is running at ${SOLUTION_SERVER_URL}`);
      return true;
    } else {
      console.error(`❌ Solution Server responded with status ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Solution Server not accessible at ${SOLUTION_SERVER_URL}`);
    console.error(`   Error: ${error.message}`);
    console.error('   💡 To start solution server:');
    console.error('      docker run -p 8000:8000 quay.io/konveyor/solution-server:latest');
    return false;
  }
}

async function checkTestDataStructure() {
  console.log('🔍 Checking test data structure...');
  
  try {
    const testReposPath = join(__dirname, '../e2e/fixtures/test-repos.json');
    const testRepos = JSON.parse(readFileSync(testReposPath, 'utf8'));
    
    if (!testRepos.coolstore) {
      console.error('❌ coolstore test repository not found in test-repos.json');
      return false;
    }
    
    console.log('✅ Test data structure is valid');
    return true;
  } catch (error) {
    console.error(`❌ Failed to check test data structure: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Validating Solution Server test prerequisites...\n');
  
  const checks = [
    checkNodeVersion,
    checkNpmDependencies,
    checkPlaywrightBrowsers,
    checkTestDataStructure,
    checkSolutionServer,
  ];
  
  const results = await Promise.all(checks.map(check => check()));
  const allPassed = results.every(result => result);
  
  console.log('\n📋 Validation Summary:');
  console.log(`   ${results.filter(r => r).length}/${results.length} checks passed`);
  
  if (allPassed) {
    console.log('\n🎉 All prerequisites met! You can run the solution server tests:');
    console.log('   npm run test -- tests/solution-server/change-acceptance.test.ts');
  } else {
    console.log('\n❌ Some prerequisites not met. Please address the issues above.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`💥 Validation script failed: ${error.message}`);
  process.exit(1);
});