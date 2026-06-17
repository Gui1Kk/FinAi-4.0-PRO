import type { ApiResult, FinanceData } from "../types";
import { normalizeFinanceData } from "../utils";

const scriptUrl = import.meta.env.VITE_GOOGLE_SCRIPT_URL?.trim() || "";
const sessionTokenKey = (username: string) => `nummi:token:${username}`;

const connectionError = <T = unknown>(message?: string): ApiResult<T> => ({
  status: "error",
  message: message || "Nao foi possivel conectar ao Google Apps Script. Verifique a URL /exec e o deploy.",
  source: "remote"
});

const requestRemote = async <T>(payload: Record<string, unknown>): Promise<ApiResult<T>> => {
  if (!scriptUrl) {
    return connectionError<T>("Google Apps Script nao configurado. Defina VITE_GOOGLE_SCRIPT_URL com a URL /exec do deploy.");
  }

  try {
    const response = await fetch(scriptUrl, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "text/plain;charset=utf-8" }
    });

    const text = await response.text();
    try {
      return JSON.parse(text) as ApiResult<T>;
    } catch {
      return connectionError<T>("O Apps Script respondeu algo que nao e JSON. Verifique se o deploy publicado e a URL /exec estao corretos.");
    }
  } catch {
    return connectionError<T>();
  }
};


export const apiService = {
  async checkConnection(): Promise<ApiResult<{ app?: string; version?: string; schemaVersion?: number }>> {
    if (!scriptUrl) {
      return connectionError<{ app?: string; version?: string; schemaVersion?: number }>("Google Apps Script nao configurado. Defina VITE_GOOGLE_SCRIPT_URL antes de usar o sistema.");
    }

    try {
      const response = await fetch(scriptUrl, { method: "GET" });
      const text = await response.text();
      const parsed = JSON.parse(text) as ApiResult<{ app?: string; version?: string; schemaVersion?: number }>;
      return parsed.status === "success" ? { ...parsed, source: "remote" } : connectionError<{ app?: string; version?: string; schemaVersion?: number }>(parsed.message);
    } catch {
      return connectionError<{ app?: string; version?: string; schemaVersion?: number }>("Apps Script offline ou inacessivel no momento.");
    }
  },

  async login(identifier: string, password: string): Promise<ApiResult<unknown>> {
    if (!identifier || !password) {
      return { status: "error", message: "Informe usuario/e-mail e senha.", source: "remote" };
    }

    return requestRemote({ action: "login", username: identifier, password });
  },

  async register(username: string, email: string, password: string): Promise<ApiResult<unknown>> {
    if (!username || !email || !password) {
      return { status: "error", message: "Informe usuario, e-mail e senha.", source: "remote" };
    }

    return requestRemote({ action: "register", username, email, password });
  },

  async loadData(username: string): Promise<ApiResult<FinanceData>> {
    const token = localStorage.getItem(sessionTokenKey(username)) || sessionStorage.getItem(sessionTokenKey(username)) || "";
    const remote = await requestRemote<FinanceData>({
      action: "load",
      username,
      token,
      page: 1,
      pageSize: 10000
    });

    if (remote.status === "success") {
      return { status: "success", data: normalizeFinanceData(remote.data), source: "remote" };
    }

    return { ...remote, source: "remote" };
  },

  async saveData(username: string, data: FinanceData): Promise<ApiResult<FinanceData>> {
    const normalized = normalizeFinanceData(data);
    const token = localStorage.getItem(sessionTokenKey(username)) || sessionStorage.getItem(sessionTokenKey(username)) || "";
    const remote = await requestRemote<FinanceData>({
      action: "save_all",
      username,
      token,
      data: normalized
    });

    if (remote.status === "success") {
      return { status: "success", data: normalized, source: "remote" };
    }

    return { ...remote, data: normalized, source: "remote" };
  }
};
