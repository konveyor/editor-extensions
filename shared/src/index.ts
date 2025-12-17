export * from "./types/index";
export * from "./transformation";
export * from "./labelSelector";
export * from "./utils/languageMapping";
export * from "./utils/diffUtils";
export * from "./api";
// Note: messaging exports manually to avoid conflicts with types/messages.ts
// Import directly: import { ... } from '@editor-extensions/shared/messaging'
