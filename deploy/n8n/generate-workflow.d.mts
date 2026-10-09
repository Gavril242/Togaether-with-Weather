export type WorkflowNode = {
  id: string; name: string; type: string; typeVersion: number; position: number[];
  parameters: Record<string, unknown>; credentials?: Record<string, { id: string; name: string }>;
  alwaysOutputData?: boolean; onError?: string; retryOnFail?: boolean;
};
export type WorkflowTemplate = {
  name: string; active: boolean; nodes: WorkflowNode[];
  connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }>;
  settings: Record<string, unknown>; staticData: null;
};
export function makeMonitorWorkflow(configuration?: {
  origin?: string; from?: string; to?: string; credentialId?: string; credentialName?: string;
}): WorkflowTemplate;
