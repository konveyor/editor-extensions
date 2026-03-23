/**
 * @deprecated Use agentCredentialStorage.ts instead. These re-exports exist
 * only for backward compatibility with any external consumers.
 */
export {
  saveAgentCredentials as saveGooseCredentials,
  loadAgentCredentials as loadGooseCredentials,
  deleteAgentCredentials as deleteGooseCredentials,
  hasAgentCredentials as hasGooseCredentials,
} from "./agentCredentialStorage";
