export type SecurityWorkflowConfiguration = {
  repository?: string; model?: string; from?: string; to?: string;
  resendCredentialId?: string; resendCredentialName?: string;
  geminiCredentialId?: string; geminiCredentialName?: string;
};
export type SecurityWorkflowNode = {
  id: string; name: string; type: string; typeVersion: number; position: number[];
  parameters: Record<string, unknown>;
  alwaysOutputData?: boolean; onError?: string; retryOnFail?: boolean;
  credentials?: { httpHeaderAuth: { id: string; name: string } };
};
export function makeSecurityWorkflow(configuration?: SecurityWorkflowConfiguration): {
  name: string; active: false; nodes: SecurityWorkflowNode[];
  connections: Record<string, { main: { node: string; type: string; index: number }[][] }>;
  settings: Record<string, unknown>; staticData: null;
};
