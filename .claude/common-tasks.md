# Common Development Tasks

## Task: Add a New Type/Interface

### Scenario

You need to add a new shared type that will be used by both the extension and webview.

### Steps

1. **Add the type to @shared**

   Edit `shared/src/types/types.ts` (or appropriate type file):

   ```typescript
   export interface MyNewType {
     id: string;
     name: string;
     data: Record<string, unknown>;
   }
   ```

2. **Export from index**

   Edit `shared/src/types/index.ts`:

   ```typescript
   export * from "./types"; // Already there, includes all exports
   ```

3. **BUILD THE SHARED WORKSPACE** ⚠️ CRITICAL

   ```bash
   npm run build -w shared
   ```

4. **Use in other workspaces**

   Extension code:

   ```typescript
   import { MyNewType } from "@editor-extensions/shared";

   const data: MyNewType = {
     id: "123",
     name: "Example",
     data: {},
   };
   ```

   Webview code:

   ```typescript
   import { MyNewType } from "@editor-extensions/shared";
   ```

### Watch Mode Alternative

Instead of manually building after each change, run in watch mode:

```bash
npm run dev -w shared
```

## Task: Add a New Webview Message Type

### Scenario

You need to send a new type of update from extension to webview.

### Steps

1. **Define the message type in @shared**

   Edit `shared/src/types/messages.ts`:

   ```typescript
   export interface MyFeatureUpdateMessage {
     type: "MY_FEATURE_UPDATE";
     featureData: MyFeatureData;
     timestamp: string;
   }

   // Add to union type
   export type WebviewMessage =
     | FullStateUpdateMessage
     | AnalysisStateUpdateMessage
     // ... existing types
     | MyFeatureUpdateMessage;

   // Add type guard
   export function isMyFeatureUpdate(msg: WebviewMessage): msg is MyFeatureUpdateMessage {
     return (msg as any).type === "MY_FEATURE_UPDATE";
   }
   ```

2. **Build @shared**

   ```bash
   npm run build -w shared
   ```

3. **Send from extension**

   In `vscode/core/src/extension.ts` or relevant file:

   ```typescript
   import { MyFeatureUpdateMessage } from "@editor-extensions/shared";

   broadcastMyFeatureUpdate() {
     const message: MyFeatureUpdateMessage = {
       type: "MY_FEATURE_UPDATE",
       featureData: this.data.featureData,
       timestamp: new Date().toISOString()
     };

     this.webviewPanel?.webview.postMessage(message);
   }
   ```

4. **Handle in webview**

   In `webview-ui/src/App.tsx` or message handler:

   ```typescript
   import { isMyFeatureUpdate } from "@editor-extensions/shared";

   window.addEventListener("message", (event) => {
     const message = event.data;

     if (isMyFeatureUpdate(message)) {
       // Update Zustand store
       useExtensionStore.setState({
         featureData: message.featureData,
       });
     }
   });
   ```

## Task: Add a New PatternFly Component

### Scenario

You want to use a new PatternFly component in the webview.

### Steps

1. **Import the component**

   ```typescript
   import {
     Card,
     CardBody,
     NewComponent, // Your new component
   } from "@patternfly/react-core";
   ```

2. **Import icons if needed**

   ```typescript
   import MyIcon from "@patternfly/react-icons/dist/esm/icons/my-icon";
   ```

3. **Use in JSX**

   ```typescript
   const MyReactComponent: React.FC = () => {
     return (
       <Card>
         <CardBody>
           <NewComponent>
             <MyIcon /> Content here
           </NewComponent>
         </CardBody>
       </Card>
     );
   };
   ```

4. **Check PatternFly docs**

   Visit: https://www.patternfly.org/components/
   - Find your component
   - Check props and examples
   - Note: Project uses PatternFly v6.x

## Task: Add a New VSCode Command

### Scenario

You need to add a new command that users can run.

### Steps

1. **Register in package.json**

   Edit `vscode/core/package.json`:

   ```json
   {
     "contributes": {
       "commands": [
         {
           "command": "konveyor-core.myNewCommand",
           "title": "My New Command",
           "category": "Konveyor",
           "icon": "$(symbol-event)"
         }
       ]
     }
   }
   ```

2. **Implement command handler**

   Create `vscode/core/src/commands/myNewCommand.ts`:

   ```typescript
   import * as vscode from "vscode";
   import { VsCodeExtension } from "../extension";

   export async function myNewCommand(extension: VsCodeExtension): Promise<void> {
     try {
       // Command logic here
       vscode.window.showInformationMessage("Command executed!");
     } catch (error) {
       extension.logger.error("Command failed", { error });
       vscode.window.showErrorMessage("Failed to execute command");
     }
   }
   ```

3. **Register in commands/index.ts**

   Edit `vscode/core/src/commands/index.ts`:

   ```typescript
   import { myNewCommand } from "./myNewCommand";

   export function registerAllCommands(
     context: vscode.ExtensionContext,
     extension: VsCodeExtension,
   ) {
     context.subscriptions.push(
       vscode.commands.registerCommand("konveyor-core.myNewCommand", () => myNewCommand(extension)),
     );
     // ... other commands
   }
   ```

4. **Build and test**
   ```bash
   npm run build -w vscode/core
   # Press F5 in VSCode to test
   ```

## Task: Update Extension State

### Scenario

You need to update the extension's state and notify the webview.

### Steps

1. **Update using Immer**

   In `vscode/core/src/extension.ts`:

   ```typescript
   import { produce } from "immer";

   updateMyFeature(newData: MyFeatureData) {
     // Update state immutably
     this.data = produce(this.data, (draft) => {
       draft.myFeature = newData;
       draft.lastUpdated = Date.now();
     });

     // Notify listeners (webviews)
     this._onDidChange.fire(this.data);

     // Or send targeted update
     this.broadcastMyFeatureUpdate();
   }
   ```

2. **Add to ExtensionData interface**

   If it's new state, add to `shared/src/types/types.ts`:

   ```typescript
   export interface ExtensionData {
     // ... existing fields
     myFeature?: MyFeatureData;
     lastUpdated?: number;
   }
   ```

3. **Build @shared**
   ```bash
   npm run build -w shared
   ```

## Task: Add State to Webview Store

### Scenario

You need to track new state in the React webview.

### Steps

1. **Update Zustand store**

   Edit `webview-ui/src/store/store.ts`:

   ```typescript
   import { create } from "zustand";
   import { ExtensionData } from "@editor-extensions/shared";

   export const useExtensionStore = create<ExtensionData>((set) => ({
     // ... existing state
     myFeature: undefined,

     // Optional: Add actions
     setMyFeature: (data: MyFeatureData) => set({ myFeature: data }),
   }));
   ```

2. **Use in components**

   ```typescript
   const MyComponent: React.FC = () => {
     const myFeature = useExtensionStore((state) => state.myFeature);

     return <div>{myFeature?.name}</div>;
   };
   ```

## Task: Add a New Test

### Scenario

You want to add a new E2E test.

### Steps

1. **Create test file**

   Create `tests/e2e/tests/base/my-feature.test.ts`:

   ```typescript
   import { test, expect } from "@playwright/test";
   import { BasePage } from "../../pages/base.page";

   test.describe("My Feature", () => {
     test("should do something", async ({ page }) => {
       const basePage = new BasePage(page);

       await basePage.navigateTo("konveyor");
       await basePage.clickMyFeatureButton();

       await expect(page.locator(".result")).toBeVisible();
     });
   });
   ```

2. **Add page object methods if needed**

   Edit `tests/e2e/pages/base.page.ts`:

   ```typescript
   export class BasePage {
     async clickMyFeatureButton() {
       await this.page.click('[data-testid="my-feature-btn"]');
     }
   }
   ```

3. **Run the test**
   ```bash
   npm run test -w tests
   # Or specific file:
   npx playwright test tests/e2e/tests/base/my-feature.test.ts
   ```

## Task: Debug the Extension

### Scenario

You need to debug extension code.

### Steps

1. **Set breakpoints** in `.ts` files in VSCode

2. **Press F5** to start Extension Development Host

3. **Trigger the code path** in the new VSCode window

4. **Check Debug Console** for output

5. **Check Output panel** (View → Output → Konveyor)

### For Webview Debugging

1. **Open webview** in Extension Development Host

2. **Help → Toggle Developer Tools**

3. **Use browser DevTools** to debug React code

## Task: Add Custom Styling

### Scenario

You need custom CSS for a component.

### Steps

1. **Create CSS file** next to component

   `webview-ui/src/components/MyComponent/styles.css`:

   ```css
   .my-component {
     padding: 1rem;
     background-color: var(--pf-v6-global--BackgroundColor--100);
   }

   .my-component__header {
     font-weight: bold;
     color: var(--pf-v6-global--Color--100);
   }
   ```

2. **Import in component**

   ```typescript
   import "./styles.css";

   const MyComponent: React.FC = () => {
     return (
       <div className="my-component">
         <h2 className="my-component__header">Title</h2>
       </div>
     );
   };
   ```

3. **Use PatternFly CSS variables** for theming

   Available variables: https://www.patternfly.org/tokens/all-patternfly-tokens

## Task: Call Analyzer RPC Method

### Scenario

You need to call a new method on the kai analyzer.

### Steps

1. **Call via AnalyzerClient**

   In extension code:

   ```typescript
   const result = await this.analyzerClient.connection.sendRequest("my_method", {
     param1: "value",
     param2: 123,
   });
   ```

2. **Handle response**

   ```typescript
   interface MyMethodResponse {
     success: boolean;
     data: string;
   }

   const response: MyMethodResponse = await this.analyzerClient.connection.sendRequest(
     "my_method",
     params,
   );

   if (response.success) {
     // Handle success
   }
   ```

3. **Handle notifications**

   For streaming/async updates:

   ```typescript
   this.analyzerClient.connection.onNotification("my_progress", (params) => {
     this.updateProgress(params.percentage);
   });
   ```

## Task: Clean Build Issues

### Scenario

You're getting strange TypeScript or build errors.

### Steps

1. **Clean all build artifacts**

   ```bash
   npm run clean
   ```

2. **Clean node_modules (if needed)**

   ```bash
   npm run clean:all
   npm install
   ```

3. **Rebuild everything**

   ```bash
   npm run build
   ```

4. **If still having issues**

   ```bash
   # Clean TypeScript caches
   rm -rf */tsconfig.tsbuildinfo
   rm -rf ./**/tsconfig.tsbuildinfo

   # Rebuild
   npm run build
   ```

## Task: Package for Distribution

### Scenario

You want to create a `.vsix` file for distribution.

### Steps

1. **Ensure assets are downloaded**

   ```bash
   npm run collect-assets:dev
   ```

2. **Build all workspaces**

   ```bash
   npm run build
   ```

3. **Create distribution directory**

   ```bash
   npm run dist
   ```

4. **Package extensions**

   ```bash
   npm run package         # All extensions
   # OR
   npm run package-core    # Just core
   npm run package-java    # Just Java
   ```

5. **Find .vsix files** in repository root

6. **Install in VSCode**
   ```bash
   code --install-extension konveyor-*.vsix
   ```
