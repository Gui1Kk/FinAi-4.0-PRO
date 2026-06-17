import type { ApiResult, FinanceData, User } from "../types";
import { emptyFinanceData, normalizeFinanceData } from "../utils";

const scriptUrl = import.meta.env.VITE_GOOGLE_SCRIPT_URL?.trim() || "";

const localDataKey = (username: string) => `nummi:data:${username}`;
const legacyDataKey = (username: string) => `finai:data:${username}`;
const localUsersKey = "nummi:users";
const legacyUsersKey = "finai:users";
const localAuthUsersKey = "nummi:authUsers";
const sessionTokenKey = (username: string) => `nummi:token:${username}`;

interface LocalAuthUser extends User {
  passwordHash: string;
  salt: string;
}

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const makeLocalToken = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const hashText = async (value: string) => {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return btoa(unescape(encodeURIComponent(value)));
};

const requestRemote = async <T>(payload: Record<string, unknown>): Promise<ApiResult<T>> => {
  if (!scriptUrl) {
    return { status: "error", message: "Google Apps Script nao configurado.", source: "local" };
  }

  const response = await fetch(scriptUrl, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "text/plain;charset=utf-8" }
  });

  const text = await response.text();
  try {
    return JSON.parse(text) as ApiResult<T>;
  } catch {
    return {
      status: "error",
      message: "O Apps Script respondeu algo que nao e JSON. Verifique o deploy /exec.",
      source: "remote"
    };
  }
};

const loadLocalData = (username: string) => {
  const next = readJson<FinanceData | null>(localDataKey(username), null);
  if (next) return normalizeFinanceData(next);

  const legacy = readJson<Partial<FinanceData> | null>(legacyDataKey(username), null);
  if (legacy) {
    const migrated = normalizeFinanceData(legacy);
    writeJson(localDataKey(username), migrated);
    return migrated;
  }

  return emptyFinanceData();
};

const saveLocalData = (username: string, data: FinanceData) => {
  writeJson(localDataKey(username), normalizeFinanceData(data));
};

const loadLocalUsers = () => ({
  ...readJson<Record<string, User>>(legacyUsersKey, {}),
  ...readJson<Record<string, User>>(localUsersKey, {})
});

const loadLocalAuthUsers = () => readJson<Record<string, LocalAuthUser>>(localAuthUsersKey, {});

const findLocalAuthUser = (identifier: string) => {
  const users = loadLocalAuthUsers();
  const normalized = identifier.toLowerCase();
  return Object.values(users).find(
    (user) => user.username.toLowerCase() === normalized || user.email?.toLowerCase() === normalized
  );
};

export const hasRemoteBackend = Boolean(scriptUrl);

export const apiService = {
  async login(identifier: string, password: string): Promise<ApiResult<unknown>> {
    if (!identifier || !password) {
      return { status: "error", message: "Informe usuario/e-mail e senha." };
    }

    if (scriptUrl) {
      try {
        const remote = await requestRemote({ action: "login", username: identifier, password });
        if (remote.status === "success") return remote;
        return remote;
      } catch {
        // Local fallback keeps the app usable while the Apps Script is being configured.
      }
    }

    const authUser = findLocalAuthUser(identifier);
    if (!authUser) {
      return { status: "error", message: "Usuario local nao encontrado. Crie uma conta local primeiro.", source: "local" };
    }

    const passwordHash = await hashText(`${authUser.salt}:${password}`);
    if (passwordHash !== authUser.passwordHash) {
      return { status: "error", message: "Senha local invalida.", source: "local" };
    }

    const user = { username: authUser.username, email: authUser.email, userId: authUser.userId, token: makeLocalToken() };
    return { status: "success", user, source: "local" };
  },

  async register(username: string, email: string, password: string): Promise<ApiResult<unknown>> {
    if (!username || !email || !password) {
      return { status: "error", message: "Informe usuario, e-mail e senha." };
    }

    if (scriptUrl) {
      try {
        const remote = await requestRemote({ action: "register", username, email, password });
        if (remote.status === "success") return remote;
        return remote;
      } catch {
        // Local fallback below.
      }
    }

    if (findLocalAuthUser(username) || findLocalAuthUser(email)) {
      return { status: "error", message: "Usuario ou e-mail local ja existe.", source: "local" };
    }

    const users = loadLocalUsers();
    const authUsers = loadLocalAuthUsers();
    const salt = makeLocalToken();
    const user = { username, email, userId: makeLocalToken(), token: makeLocalToken() };
    authUsers[username] = {
      ...user,
      salt,
      passwordHash: await hashText(`${salt}:${password}`)
    };
    users[username] = user;
    writeJson(localAuthUsersKey, authUsers);
    writeJson(localUsersKey, users);
    return { status: "success", user, source: "local" };
  },

  async loadData(username: string): Promise<ApiResult<FinanceData>> {
    const token = localStorage.getItem(sessionTokenKey(username)) || sessionStorage.getItem(sessionTokenKey(username)) || "";
    if (scriptUrl) {
      try {
        const remote = await requestRemote<FinanceData>({
          action: "load",
          username,
          token,
          page: 1,
          pageSize: 10000
        });
        if (remote.status === "success") {
          const data = normalizeFinanceData(remote.data);
          saveLocalData(username, data);
          return { status: "success", data, source: "remote" };
        }
      } catch {
        // Fallback below.
      }
    }

    return { status: "success", data: loadLocalData(username), source: "local" };
  },

  async saveData(username: string, data: FinanceData): Promise<ApiResult<FinanceData>> {
    const normalized = normalizeFinanceData(data);
    saveLocalData(username, normalized);
    const token = localStorage.getItem(sessionTokenKey(username)) || sessionStorage.getItem(sessionTokenKey(username)) || "";

    if (!scriptUrl) {
      return { status: "success", data: normalized, source: "local" };
    }

    try {
      const remote = await requestRemote<FinanceData>({
        action: "save_all",
        username,
        token,
        data: normalized
      });

      if (remote.status === "success") {
        return { status: "success", data: normalized, source: "remote" };
      }

      return { status: "error", message: remote.message, data: normalized, source: "remote" };
    } catch {
      return {
        status: "error",
        message: "Dados salvos localmente, mas a sincronizacao com a nuvem falhou.",
        data: normalized,
        source: "local"
      };
    }
  }
};
