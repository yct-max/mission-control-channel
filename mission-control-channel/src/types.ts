// ─── MC Event Types ─────────────────────────────────────────────────────────────

export interface McTaskEvent {
  event_type: string;
  task_id: string;
  timestamp: string;
  actor: string;
  task: {
    id: string;
    title: string;
    status: string;
    assignee: string | null;
    priority: string | null;
    description: string | null;
    tags: string[];
  };
  comment?: {
    id: number;
    body: string;
  };
}

// ─── MC API Client ─────────────────────────────────────────────────────────────

export interface McClient {
  getTask(taskId: string): Promise<McTask>;
  addComment(taskId: string, body: string): Promise<{ id: number }>;
  updateTaskStatus(taskId: string, status: string): Promise<McTask>;
}

export interface McTask {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  priority: string | null;
  description: string | null;
  tags: string[];
  owner: string | null;
}

// ─── Routing ───────────────────────────────────────────────────────────────────

export interface AgentRoutingEntry {
  assignee: string;
  sessionKey: string;
  displayName: string;
  token: string;
}

export type AgentRoutingTable = Record<string, AgentRoutingEntry>;

export const DEFAULT_ROUTING: AgentRoutingTable = {
  alex: { assignee: "alex", sessionKey: "agent:alex:main", displayName: "Agent Alex", token: "" },
  monica: { assignee: "monica", sessionKey: "agent:monica:main", displayName: "Agent Monica", token: "" },
  quinn: { assignee: "quinn", sessionKey: "agent:quinn:main", displayName: "Agent Quinn", token: "" },
};
