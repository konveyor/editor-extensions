/**
 * Development exports for ResolutionsPage with test capabilities.
 *
 * USAGE:
 * In your app's routing or parent components, conditionally import based on environment:
 *
 * ```typescript
 * // Option 1: Dynamic import
 * const ResolutionsPageModule = process.env.NODE_ENV === 'development'
 *   ? await import('./components/ResolutionsPage/index.dev')
 *   : await import('./components/ResolutionsPage');
 *
 * // Option 2: Webpack alias (configure in webpack.config.js)
 * // Then just: import { ResolutionPage } from './components/ResolutionsPage';
 * ```
 */

// Re-export everything from the production index
export * from "./index";

// Override the default export with the dev version
export { default as ResolutionPage } from "./ResolutionsPage.dev";
export { default } from "./ResolutionsPage.dev";
