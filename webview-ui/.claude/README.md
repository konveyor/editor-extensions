# @editor-extensions/webview-ui

## Purpose

React-based webview frontend for VSCode extension panels.

## Tech Stack

- **React 18.3.1** - UI framework
- **PatternFly 6.x** - Component library & design system
- **Vite** - Build tool & dev server
- **Zustand** - State management
- **TypeScript** - Type safety

## Dependencies

**Requires**: `@editor-extensions/shared` must be built first

```bash
npm run build -w shared  # If types are missing
```

## Development

**Dev server** (with hot reload):

```bash
npm run start -w webview-ui
# Or from root:
npm run dev  # Starts everything including webview
```

**Production build**:

```bash
npm run build -w webview-ui
```

## PatternFly Components

### Core Packages

```typescript
import {
  Button,
  Card,
  CardBody,
  Page,
  PageSection,
  // ... many more
} from "@patternfly/react-core";

import MyIcon from "@patternfly/react-icons/dist/esm/icons/my-icon";
```

### Documentation

- Docs: https://www.patternfly.org/components/
- Version: **v6.x** (check package.json for exact version)

### Common Components Used

- **Layout**: Page, Card, Drawer, Toolbar, Flex, Stack, Grid
- **Data Display**: Table, DescriptionList, EmptyState
- **Forms**: Form, TextInput, Select, Switch
- **Feedback**: Alert, Spinner, Progress, Modal
- **Navigation**: Tabs, Masthead

## State Management (Zustand)

**Store location**: `src/store/store.ts`

**Usage**:

```typescript
import { useExtensionStore } from "../../store/store";

const MyComponent: React.FC = () => {
  const isAnalyzing = useExtensionStore((state) => state.isAnalyzing);
  const ruleSets = useExtensionStore((state) => state.ruleSets);

  return <div>{isAnalyzing ? "Loading..." : "Ready"}</div>;
};
```

## Extension Communication

### Receiving Messages from Extension

```typescript
import { isAnalysisStateUpdate } from "@editor-extensions/shared";

window.addEventListener("message", (event) => {
  const message = event.data;

  if (isAnalysisStateUpdate(message)) {
    useExtensionStore.setState({
      ruleSets: message.ruleSets,
      isAnalyzing: message.isAnalyzing,
    });
  }
});
```

### Sending Messages to Extension

```typescript
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";

const handleAction = () => {
  dispatch({
    type: "RUN_ANALYSIS",
    payload: { profileId: "my-profile" },
  });
};
```

## Component Patterns

### Basic Component Structure

```typescript
import React from "react";
import { Card, CardBody } from "@patternfly/react-core";
import { useExtensionStore } from "../../store/store";
import "./styles.css";

const MyComponent: React.FC = () => {
  const data = useExtensionStore((state) => state.data);

  return (
    <Card>
      <CardBody>
        {/* Your content */}
      </CardBody>
    </Card>
  );
};

export default MyComponent;
```

### With PatternFly Icons

```typescript
import ClockIcon from "@patternfly/react-icons/dist/esm/icons/clock-icon";

<Button icon={<ClockIcon />}>
  Click me
</Button>
```

## Key Pages

Located in `src/components/`:

- **AnalysisPage** - Analysis results and violations
- **ResolutionsPage** - AI solutions and chat interface
- **ProfileManagerPage** - Profile management
- **HubSettingsPage** - Hub configuration

## Custom Styling

Create `styles.css` next to component:

```css
.my-component {
  padding: var(--pf-v6-global--spacer--md);
  background-color: var(--pf-v6-global--BackgroundColor--100);
}
```

**Use PatternFly CSS variables** for theming:

- https://www.patternfly.org/tokens/all-patternfly-tokens

## Markdown & Code Rendering

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

## Build Configuration

**Vite config**: `vite.config.ts`

- Output: `build/` directory
- Base path: `/out/webview`
- Inline sourcemaps for debugging
- Reads extension name from `../vscode/core/package.json`

## Common Tasks

### Add a New Page

1. Create component in `src/components/MyPage/`
2. Register webview provider in extension
3. Add VSCode command to open it
4. Define message types in `@shared` (if needed)

### Add New State

1. Update `ExtensionData` in `@shared`
2. Build shared: `npm run build -w shared`
3. Use in Zustand store automatically (it extends ExtensionData)

### Debug Webview

1. Open webview in Extension Development Host
2. **Help → Toggle Developer Tools**
3. Use browser DevTools as normal
4. Check Console for errors/logs
