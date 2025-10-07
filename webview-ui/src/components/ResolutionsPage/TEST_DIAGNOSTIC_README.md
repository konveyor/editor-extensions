# Test Diagnostic Injector

This is a development tool to quickly test the DiagnosticIssuesView component without needing to run the full analysis workflow.

## Architecture

The test functionality is completely separated from production code to avoid any pollution of the ResolutionsPage component.

### Components:

- **`ResolutionsPage.tsx`** - Clean production component with ZERO test code
- **`ResolutionsPage.dev.tsx`** - Development wrapper that adds test functionality
- **`TestDiagnosticInjector.tsx`** - The UI component with the test button
- **`index.dev.ts`** - Development barrel export

## How to Use

### Option 1: Import the dev version directly

```typescript
// For development testing:
import ResolutionPage from "./components/ResolutionsPage/ResolutionsPage.dev";

// For production:
import ResolutionPage from "./components/ResolutionsPage/ResolutionsPage";
```

### Option 2: Use conditional imports

```typescript
const ResolutionPage =
  process.env.NODE_ENV === "development"
    ? require("./components/ResolutionsPage/ResolutionsPage.dev").default
    : require("./components/ResolutionsPage/ResolutionsPage").default;
```

### Option 3: Configure webpack alias (recommended)

Add to your webpack.config.js:

```javascript
resolve: {
  alias: {
    './ResolutionsPage': process.env.NODE_ENV === 'development'
      ? './ResolutionsPage.dev'
      : './ResolutionsPage'
  }
}
```

## Using the Test Tool

1. Start your development server
2. Navigate to the Resolutions page in the webview
3. Look for the red "🧪 Inject Test Diagnostic" button in the bottom-right corner
4. Click the button to inject a sample diagnostic message with:
   - 8 sample issues across 4 different files
   - Various issue types (imports, API migrations, config updates)
   - Yes/No quick response buttons for testing the fix workflow

## Features Tested

- File grouping and expansion
- Checkbox selection (individual issues and whole files)
- "Select All" functionality with indeterminate state
- Issue count display
- File click to open in editor
- Quick response buttons integration
- Selection state management

## Customization

To modify the test data, edit `TestDiagnosticInjector.tsx` and update the `diagnosticSummary` object in the `createTestDiagnosticMessage` function.

## Cleanup

When done testing, simply:

1. Remove any development imports and use production imports
2. Delete these files:
   - `ResolutionsPage.dev.tsx`
   - `TestDiagnosticInjector.tsx`
   - `index.dev.ts`
   - This README file

The ResolutionsPage component remains completely unchanged and clean!
