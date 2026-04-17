import type { McClient, McTask } from "./types.js";

export interface McClientConfig {
  baseUrl: string;
  agentToken: string;
}

export function createMcClient(config: McClientConfig): McClient {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.agentToken}`,
  };

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${config.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MC API error ${response.status}: ${text}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    async getTask(taskId: string): Promise<McTask> {
      return request<McTask>(`/api/tasks/${taskId}`);
    },

    async addComment(taskId: string, body: string): Promise<{ id: number }> {
      return request<{ id: number }>(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    },

    async updateTaskStatus(taskId: string, status: string): Promise<McTask> {
      return request<McTask>(`/api/tasks/${taskId}/status`, {
        method: "POST",
        body: JSON.stringify({ target_status: status }),
      });
    },
  };
}
