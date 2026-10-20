/**
 * The slice of the agentic platform's resource contract the IDE uses.
 *
 * Source of truth: konveyor/agentic-controller api/v1alpha1. Mirrors
 * tackle2-ui's client/src/app/api/agentic/contract.ts so both consoles read
 * the same shapes (epic #1511 tracks moving this into one shared package).
 */

export interface ObjectMeta {
  name?: string;
  generateName?: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface Condition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export type AgentRunPhase = "Pending" | "Running" | "Succeeded" | "Failed";

/** Supervision mode for a run (agentic-controller ADR 0011). */
export type ExecutionMode = "auto" | "approve";

export interface AgentRunSpec {
  agentRef: string;
  params?: Array<{ name: string; value: string }>;
  instructions?: string;
  gateway?: string;
  execution?: { mode?: ExecutionMode; askUser?: boolean; maxTurns?: number; maxCost?: string };
  env?: Array<{ name: string; value: string }>;
}

/** What the migration harness reports in status.terminationData. */
export interface HarnessTerminationData {
  exitCode?: number;
  /** "succeeded" | "failed" | "limitReached" */
  outcome?: string;
  limitReached?: string;
  stopReason?: string;
}

export interface AgentRunStatus {
  phase?: AgentRunPhase;
  sandboxName?: string;
  startTime?: string;
  completionTime?: string;
  conditions?: Condition[];
  terminationData?: HarnessTerminationData;
}

export interface AgentRun {
  apiVersion?: string;
  kind?: string;
  metadata: ObjectMeta;
  spec: AgentRunSpec;
  status?: AgentRunStatus;
}

export interface AgentParam {
  name: string;
  type?: "string" | "number" | "boolean";
  description?: string;
  default?: string;
  required?: boolean;
}

export interface AgentResource {
  metadata: ObjectMeta;
  spec: {
    image: string;
    prompt?: string;
    params?: AgentParam[];
    gateways?: Array<{ ref: string }>;
  };
  status?: { conditions?: Condition[] };
}

/**
 * The run's ACP endpoint accepts connections (agentic-controller#160):
 * True once the sandbox listens, False/Finished once the run is over.
 * Clients dial on this condition and nothing else.
 */
export const ACP_READY_CONDITION = "ACPReady";
export const ACP_FINISHED_REASON = "Finished";

/** Marks an agent whose harness needs Hub context (APP_ID, TARGET_BRANCH). */
export const MANAGED_LABEL = "konveyor.io/managed";
/** Stamped on runs at create so per-application views are a label selector. */
export const APPLICATION_LABEL = "konveyor.io/application";

export function isTerminalPhase(phase: AgentRunPhase | undefined): boolean {
  return phase === "Succeeded" || phase === "Failed";
}

export function acpReady(run: AgentRun): Condition | undefined {
  return run.status?.conditions?.find((c) => c.type === ACP_READY_CONDITION);
}
