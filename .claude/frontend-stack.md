# Frontend Stack (Webview UI)

## Technology Stack

The webview UI (`webview-ui/`) is built with:

- **React 18.3.1** - UI framework
- **PatternFly 6.x** - Red Hat's design system
- **Vite** - Build tool and dev server
- **TypeScript** - Type safety
- **Zustand** - State management

## PatternFly Components

The project uses the PatternFly component library extensively:

### Core Dependencies

```json
"@patternfly/patternfly": "^6.3.0",
"@patternfly/react-core": "^6.3.0",
"@patternfly/react-icons": "^6.1.0",
"@patternfly/react-table": "^6.3.0",
"@patternfly/react-code-editor": "^6.0.0",
"@patternfly/react-component-groups": "^6.2.1",
"@patternfly/chatbot": "^6.3.0"
```

### Common PatternFly Components Used

From `@patternfly/react-core`:

- Layout: `Page`, `PageSection`, `Card`, `CardHeader`, `CardBody`, `Drawer`, `Toolbar`
- Data Display: `DescriptionList`, `Table`, `EmptyState`
- Navigation: `Tabs`, `Masthead`, `PageSidebar`
- Forms: `Form`, `FormGroup`, `TextInput`, `Select`, `Switch`
- Feedback: `Alert`, `AlertGroup`, `Spinner`, `Progress`
- Utilities: `Flex`, `Stack`, `Grid`, `Tooltip`, `Modal`

From `@patternfly/react-icons`:

- Import as: `import IconName from "@patternfly/react-icons/dist/esm/icons/icon-name"`
- Example: `import ClockIcon from "@patternfly/react-icons/dist/esm/icons/clock-icon"`

### Styling

PatternFly styles are imported globally and use CSS variables for theming:

- Import pattern: `import "@patternfly/patternfly/patternfly.css"`
- Custom component styles: `import "./styles.css"` (component-local CSS files)

## State Management

### Zustand Store

The application uses Zustand for global state management:

**Store location**: `webview-ui/src/store/store.ts`

The store mirrors the `ExtensionData` interface from `@editor-extensions/shared` and includes:

- Analysis state (ruleSets, enhancedIncidents, isAnalyzing)
- Server state (serverState, solutionServerConnected)
- Solution workflow state (isFetchingSolution, solutionState)
- Chat messages and profiles
- Configuration and errors

**Usage pattern**:

```typescript
import { useExtensionStore } from "../../store/store";

const MyComponent: React.FC = () => {
  const isAnalyzing = useExtensionStore((state) => state.isAnalyzing);
  const ruleSets = useExtensionStore((state) => state.ruleSets);
  // ... component logic
};
```

### VSCode Extension ↔ Webview Communication

The webview receives updates from the VSCode extension via message passing:

**Message types** (from `@editor-extensions/shared`):

- `FullStateUpdateMessage` - Complete state (initial load)
- `AnalysisStateUpdateMessage` - Analysis updates
- `ChatMessagesUpdateMessage` - Chat updates
- `SolutionWorkflowUpdateMessage` - Solution workflow updates
- `ServerStateUpdateMessage` - Server state updates
- `ProfilesUpdateMessage` - Profile updates
- And more (see `shared/src/types/messages.ts`)

**Receiving messages**:

```typescript
import { sendVscodeMessage } from "../../utils/vscodeMessaging";

// Listen for messages from extension
window.addEventListener("message", (event) => {
  const message = event.data;
  // Handle different message types
});
```

**Sending messages to extension**:

```typescript
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";

dispatch({
  type: "SOME_ACTION",
  payload: { ... }
});
```

## Markdown and Code Rendering

The webview includes rich markdown and code rendering:

```json
{
  "react-markdown": "^9.0.3",
  "rehype-highlight": "^7.0.2", // Syntax highlighting
  "rehype-raw": "^7.0.0", // Allow raw HTML
  "rehype-sanitize": "^6.0.0", // Sanitize HTML
  "remark-gfm": "^4.0.1", // GitHub Flavored Markdown
  "highlight.js": "^11.11.1",
  "github-markdown-css": "^5.8.1"
}
```

**Usage pattern**:

```typescript
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight]}
>
  {markdownContent}
</ReactMarkdown>
```

## Vite Configuration

**Config file**: `webview-ui/vite.config.ts`

Key configuration:

- Reads extension name from `vscode/core/package.json`
- Output: `build/` directory
- Base path: `/out/webview` (matches dist structure)
- Inline sourcemaps for VSCode debugging
- Public assets from `../assets/` directory

## Development Patterns

### Component Structure

```typescript
import React from "react";
import {
  Card,
  CardBody,
  Button
} from "@patternfly/react-core";
import IconName from "@patternfly/react-icons/dist/esm/icons/icon-name";
import { useExtensionStore } from "../../store/store";
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";

const MyComponent: React.FC = () => {
  const someState = useExtensionStore((state) => state.someState);

  const handleAction = () => {
    dispatch({ type: "DO_SOMETHING" });
  };

  return (
    <Card>
      <CardBody>
        <Button onClick={handleAction}>
          <IconName /> Click Me
        </Button>
      </CardBody>
    </Card>
  );
};

export default MyComponent;
```

### Custom Hooks

Located in `webview-ui/src/hooks/`:

- `actions.ts` - Action creators for dispatching to extension
- `useViolations.ts` - Hooks for working with violation data

## Building and Running

```bash
# Development server (with hot reload)
npm run start -w webview-ui

# Production build
npm run build -w webview-ui

# Clean build artifacts
npm run clean -w webview-ui
```

The dev server requires `shared/dist/index.mjs` to exist first (enforced by `wait-on` in the root dev script).

## Key Pages

The webview has several main pages:

- `AnalysisPage` - Shows analysis results and violations
- `ResolutionsPage` - Shows AI-generated solutions and chat
- `ProfileManagerPage` - Manages analysis profiles
- `HubSettingsPage` - Configures Hub connection

Each page is a standalone React component that uses PatternFly for layout and components.
