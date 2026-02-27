import type { FeatureModule } from "./featureRegistry";
import { gooseFeatureModule } from "./goose";

/**
 * All experimental feature modules. To add a new feature:
 * 1. Create a directory under src/features/<name>/
 * 2. Export a FeatureModule from its index.ts
 * 3. Add it to this array
 *
 * That's it — no changes to extension.ts needed.
 */
export const featureModules: FeatureModule[] = [gooseFeatureModule];
