# Dual-Branding System

This project supports both **Konveyor** (upstream) and **MTA** (downstream) branding through a dynamic system that automatically adapts based on the publisher configuration.

## How It Works

The branding system automatically detects the publisher from the root `package.json` and applies the appropriate:

- **Avatars**: Bot avatars in chat messages
- **Icons**: VSCode extension icons
- **Brand Names**: Display names throughout the UI
- **Command Categories**: VSCode command organization

## Switching Between Brands

### Quick Brand Switching

Use the npm scripts to quickly switch between brands:

```bash
# Switch to Konveyor branding
npm run brand:konveyor

# Switch to MTA branding
npm run brand:mta
```

### Manual Brand Switching

1. **Update the publisher in root `package.json`:**

   ```json
   {
     "publisher": "konveyor" // or "mta"
   }
   ```

2. **Rebuild the project:**
   ```bash
   npm run build
   ```

## Brand-Specific Assets

### Avatars

- **Konveyor**: `webview-ui/src/components/ResolutionsPage/konveyor_avatar.svg`
- **MTA**: `webview-ui/src/components/ResolutionsPage/mta_avatar.svg`

### Icons

- **Konveyor**: `vscode/resources/konveyor-icon.svg`
- **MTA**: `vscode/resources/mta-icon.svg`

### Dynamic Selection

The `BrandedAvatar` component automatically selects the appropriate avatar based on the publisher:

```tsx
import BrandedAvatar from "./BrandedAvatar";

// Automatically shows Konveyor or MTA avatar based on publisher
<BrandedAvatar />;
```

## Configuration

### Vite Configuration

The webview UI automatically detects the publisher and sets environment variables:

```typescript
// webview-ui/vite.config.ts
define: {
  __PUBLISHER__: JSON.stringify(publisher),
  __BRAND_NAME__: JSON.stringify(publisher === "konveyor" ? "Konveyor" : "MTA"),
}
```

### Branding Utilities

Use the branding utilities to get the current brand information:

```typescript
import { getPublisher, getBrandName, isKonveyor, isMTA } from "../utils/branding";

const publisher = getPublisher(); // "konveyor" or "mta"
const brandName = getBrandName(); // "Konveyor" or "MTA"
const isKonveyorBrand = isKonveyor(); // true/false
const isMTABrand = isMTA(); // true/false
```

## Development Workflow

1. **Start with Konveyor branding** (default)
2. **Switch to MTA branding** when needed: `npm run brand:mta`
3. **Build and test** with new branding: `npm run build`
4. **Switch back** if needed: `npm run brand:konveyor`

## Notes

- **Command IDs remain unchanged** for compatibility (e.g., `konveyor.*` commands)
- **Internal references** use the publisher-agnostic naming
- **User-facing elements** automatically adapt to the current brand
- **No code changes needed** when switching brands - just configuration updates

## Troubleshooting

If branding doesn't update:

1. **Check publisher value** in root `package.json`
2. **Clear build cache**: `npm run clean`
3. **Rebuild**: `npm run build`
4. **Restart VSCode** to see icon changes

The system is designed to be transparent and maintainable, allowing developers to work with either brand without code modifications.
