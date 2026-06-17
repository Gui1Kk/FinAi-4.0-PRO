import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Cloud,
  CloudOff,
  CreditCard,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Home,
  LoaderCircle,
  LogOut,
  Moon,
  PiggyBank,
  Plus,
  Repeat2,
  Save,
  Settings,
  Sun,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  WalletCards,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiService, hasRemoteBackend } from "./services/api";
import type {
  Budget,
  DatePreset,
  FinanceData,
  FinancialSummary,
  Goal,
  Investment,
  InvestmentReturn,
  NotificationItem,
  NotificationType,
  Recurrence,
  RecurrenceFrequency,
  SyncStatus,
  Transaction,
  TransactionType,
  User,
  Voucher
} from "./types";
import {
  buildTransactionFromRecurrence,
  calculateNextDate,
  calculateSummary,
  clamp,
  currentMonthKey,
  daysBetween,
  emptyFinanceData,
  formatCurrency,
  formatDate,
  groupByAmount,
  makeId,
  normalizeFinanceData,
  parseNumber,
  resolveDateRange,
  todayIso,
  toMonthKey
} from "./utils";

type View = "dashboard" | "transactions" | "budgets" | "vouchers" | "recurring" | "investments" | "goals" | "reports" | "settings";
type ToastType = "success" | "error" | "warning" | "info";

interface ToastState {
  message: string;
  type: ToastType;
}

interface DateFilterState {
  preset: DatePreset;
  start: string;
  end: string;
}

interface AuthScreenProps {
  onLogin: (user: User, remember: boolean) => void;
}

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

const appName = "Nummi";
const categories = ["Geral", "Moradia", "Alimentacao", "Transporte", "Mercado", "Lazer", "Saude", "Trabalho", "Educacao", "Divida"];
const investmentTypes = ["Renda Fixa", "Renda Variavel", "Fundos Imobiliarios", "Cripto", "Reserva de Emergencia", "Outros"];
const chartColors = ["#14b8a6", "#f97316", "#2563eb", "#e11d48", "#8b5cf6", "#84cc16", "#f59e0b"];
const datePresets: Array<{ id: DatePreset; label: string }> = [
  { id: "all", label: "Tudo" },
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "currentMonth", label: "Mes atual" },
  { id: "lastMonth", label: "Mes passado" },
  { id: "currentYear", label: "Ano" },
  { id: "custom", label: "Personalizado" }
];
const frequencyLabels: Record<RecurrenceFrequency, string> = {
  weekly: "Semanal",
  monthly: "Mensal",
  yearly: "Anual"
};
const navItems: Array<{ id: View; icon: LucideIcon; label: string }> = [
  { id: "dashboard", icon: Home, label: "Visao Geral" },
  { id: "transactions", icon: WalletCards, label: "Transacoes" },
  { id: "budgets", icon: ClipboardList, label: "Orcamentos" },
  { id: "vouchers", icon: CreditCard, label: "Vales" },
  { id: "recurring", icon: Repeat2, label: "Recorrencias" },
  { id: "investments", icon: PiggyBank, label: "Carteira" },
  { id: "goals", icon: Target, label: "Metas" },
  { id: "reports", icon: BarChart3, label: "Relatorios" },
  { id: "settings", icon: Settings, label: "Ajustes" }
];

const sessionKeys = {
  localUser: "nummi:user:persistent",
  sessionUser: "nummi:user:session",
  legacyLocalUser: "finai:user:persistent",
  legacySessionUser: "finai:user:session",
  theme: "nummi:theme"
};

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

const maskValue = (value: string, privacyMode: boolean) => (privacyMode ? "R$ *****" : value);

const readStoredUser = () => {
  const raw =
    localStorage.getItem(sessionKeys.localUser) ||
    sessionStorage.getItem(sessionKeys.sessionUser) ||
    localStorage.getItem(sessionKeys.legacyLocalUser) ||
    sessionStorage.getItem(sessionKeys.legacySessionUser);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
};

const storeUser = (user: User, remember: boolean) => {
  sessionStorage.removeItem(sessionKeys.sessionUser);
  localStorage.removeItem(sessionKeys.localUser);
  sessionStorage.removeItem(sessionKeys.legacySessionUser);
  localStorage.removeItem(sessionKeys.legacyLocalUser);
  const target = remember ? localStorage : sessionStorage;
  target.setItem(remember ? sessionKeys.localUser : sessionKeys.sessionUser, JSON.stringify(user));
};

const clearStoredUser = () => {
  localStorage.removeItem(sessionKeys.localUser);
  sessionStorage.removeItem(sessionKeys.sessionUser);
  localStorage.removeItem(sessionKeys.legacyLocalUser);
  sessionStorage.removeItem(sessionKeys.legacySessionUser);
};

const tokenKey = (username: string) => `nummi:token:${username}`;

const storeSessionToken = (user: User, remember: boolean) => {
  if (!user.token) return;
  sessionStorage.removeItem(tokenKey(user.username));
  localStorage.removeItem(tokenKey(user.username));
  const target = remember ? localStorage : sessionStorage;
  target.setItem(tokenKey(user.username), user.token);
};

const playTone = (enabled: boolean) => {
  if (!enabled) return;
  try {
    const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor = window.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
  } catch {
    // Audio feedback is optional.
  }
};

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return (
    <button className={cx("toast", `toast--${toast.type}`)} onClick={onClose} type="button">
      <CheckCircle2 size={18} />
      <span>{toast.message}</span>
      <X size={16} />
    </button>
  );
}

function EmptyState({ title, action }: { title: string; action?: string }) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      {action ? <span>{action}</span> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  privacyMode
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "neutral" | "good" | "bad" | "blue" | "warm";
  privacyMode: boolean;
}) {
  return (
    <section className={cx("metric-card", `metric-card--${tone}`)}>
      <div>
        <span>{label}</span>
        <strong>{maskValue(formatCurrency(value), privacyMode)}</strong>
      </div>
      <Icon size={24} />
    </section>
  );
}

function ProgressBar({ current, total, warn }: { current: number; total: number; warn?: boolean }) {
  const percentage = total > 0 ? clamp((current / total) * 100) : 0;
  return (
    <div className={cx("progress", warn && "progress--warn")} aria-label={`${Math.round(percentage)}%`}>
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}

function PieChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const filtered = data.filter((item) => item.value > 0);
  const total = filtered.reduce((sum, item) => sum + item.value, 0);

  if (!total) {
    return <EmptyState title="Sem dados suficientes para grafico." />;
  }

  let cumulative = 0;
  const slices = filtered.map((item, index) => {
    const start = cumulative / total;
    cumulative += item.value;
    const end = cumulative / total;
    const largeArc = end - start > 0.5 ? 1 : 0;
    const startX = Math.cos(2 * Math.PI * start);
    const startY = Math.sin(2 * Math.PI * start);
    const endX = Math.cos(2 * Math.PI * end);
    const endY = Math.sin(2 * Math.PI * end);
    const path =
      item.value === total
        ? "M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0"
        : `M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArc} 1 ${endX} ${endY} Z`;
    return <path key={item.label} d={path} fill={chartColors[index % chartColors.length]} />;
  });

  return (
    <div className="chart-block">
      <svg className="pie-chart" viewBox="-1.1 -1.1 2.2 2.2" role="img" aria-label="Grafico de pizza">
        <g transform="rotate(-90)">{slices}</g>
      </svg>
      <div className="chart-legend">
        {filtered.slice(0, 7).map((item, index) => (
          <div key={item.label}>
            <span style={{ background: chartColors[index % chartColors.length] }} />
            <p>{item.label}</p>
            <strong>{Math.round((item.value / total) * 100)}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthScreen({ onLogin }: AuthScreenProps) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const result = isRegister
      ? await apiService.register(username.trim(), email.trim(), password)
      : await apiService.login(username.trim(), password);

    setLoading(false);

    if (result.status === "success" && result.user) {
      onLogin(result.user, remember);
      return;
    }

    setError(result.message || "Nao foi possivel autenticar.");
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <WalletCards size={42} />
          <div>
            <h1>{appName}</h1>
            <p>Controle financeiro direto, recorrente e sem consumo de IA.</p>
          </div>
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label>
            Usuario ou e-mail
            <input value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" />
          </label>

          {isRegister ? (
            <label>
              E-mail
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required autoComplete="email" />
            </label>
          ) : null}

          <label>
            Senha
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              minLength={3}
              autoComplete={isRegister ? "new-password" : "current-password"}
            />
          </label>

          <label className="check-row">
            <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
            Manter conectado neste navegador
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <button className="primary-button" disabled={loading} type="submit">
            {loading ? <LoaderCircle className="spin" size={18} /> : null}
            {isRegister ? "Criar conta" : "Entrar"}
          </button>
        </form>

        <button className="link-button" onClick={() => setIsRegister((current) => !current)} type="button">
          {isRegister ? "Ja tenho conta" : "Criar uma nova conta"}
        </button>
      </section>
    </main>
  );
}

function Dashboard({ user, onLogout }: DashboardProps) {
  const [view, setView] = useState<View>("dashboard");
  const [data, setData] = useState<FinanceData>(emptyFinanceData);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [privacyMode, setPrivacyMode] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [budgetMonth, setBudgetMonth] = useState(currentMonthKey());
  const [transactionQuery, setTransactionQuery] = useState("");
  const [transactionDateFilter, setTransactionDateFilter] = useState<DateFilterState>({
    preset: "currentMonth",
    start: "",
    end: ""
  });
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<"all" | TransactionType>("all");

  const [editingTransaction, setEditingTransaction] = useState<string | null>(null);
  const [transactionForm, setTransactionForm] = useState({
    description: "",
    amount: "",
    type: "expense" as TransactionType,
    category: "Geral",
    date: todayIso(),
    note: ""
  });

  const [editingVoucher, setEditingVoucher] = useState<string | null>(null);
  const [voucherForm, setVoucherForm] = useState({ name: "", total: "", used: "", autoRenew: true, renewDay: "1" });
  const [voucherUseId, setVoucherUseId] = useState<string | null>(null);
  const [voucherUseAmount, setVoucherUseAmount] = useState("");
  const [voucherUseNote, setVoucherUseNote] = useState("");

  const [editingInvestment, setEditingInvestment] = useState<string | null>(null);
  const [investmentForm, setInvestmentForm] = useState({
    name: "",
    amount: "",
    type: "Renda Fixa",
    isDeductible: false
  });
  const [editingInvestmentReturn, setEditingInvestmentReturn] = useState<string | null>(null);
  const [investmentReturnForm, setInvestmentReturnForm] = useState({
    investmentId: "",
    month: currentMonthKey(),
    amount: "",
    percent: "",
    note: ""
  });

  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState({ name: "", current: "", target: "", targetDate: "" });

  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [budgetForm, setBudgetForm] = useState({ category: "Geral", amount: "", month: currentMonthKey(), rollover: false });

  const [editingRecurrence, setEditingRecurrence] = useState<string | null>(null);
  const [recurrenceForm, setRecurrenceForm] = useState({
    description: "",
    amount: "",
    type: "expense" as TransactionType,
    category: "Geral",
    frequency: "monthly" as RecurrenceFrequency,
    nextDate: todayIso(),
    active: true,
    autoPost: false
  });

  const summary = useMemo(() => calculateSummary(data, budgetMonth), [data, budgetMonth]);
  const expensesByCategory = useMemo(
    () => groupByAmount(data.transactions.filter((item) => item.type === "expense"), "category", "amount"),
    [data.transactions]
  );
  const currentExpensesByCategory = useMemo(
    () =>
      groupByAmount(
        data.transactions.filter((item) => item.type === "expense" && toMonthKey(item.date) === budgetMonth),
        "category",
        "amount"
      ),
    [data.transactions, budgetMonth]
  );
  const investmentsByType = useMemo(() => groupByAmount(data.investments, "type", "amount"), [data.investments]);
  const investmentReturnsByMonth = useMemo(
    () => groupByAmount(data.investmentReturns, "month", "amount"),
    [data.investmentReturns]
  );
  const vouchersUsage = useMemo(() => data.vouchers.map((item) => ({ label: item.name, value: item.used })), [data.vouchers]);
  const unreadCount = data.notifications.filter((item) => !item.read).length;
  const transactionRange = useMemo(
    () => resolveDateRange(transactionDateFilter.preset, transactionDateFilter.start, transactionDateFilter.end),
    [transactionDateFilter]
  );

  const filteredTransactions = useMemo(() => {
    const query = transactionQuery.trim().toLowerCase();
    return data.transactions.filter((item) => {
      const matchesQuery = !query || `${item.description} ${item.category} ${item.note || ""}`.toLowerCase().includes(query);
      const matchesStart = !transactionRange.start || item.date >= transactionRange.start;
      const matchesEnd = !transactionRange.end || item.date <= transactionRange.end;
      const matchesType = transactionTypeFilter === "all" || item.type === transactionTypeFilter;
      return matchesQuery && matchesStart && matchesEnd && matchesType;
    });
  }, [data.transactions, transactionQuery, transactionRange, transactionTypeFilter]);

  useEffect(() => {
    let mounted = true;
    setSyncStatus("loading");
    apiService.loadData(user.username).then((result) => {
      if (!mounted) return;
      if (result.status === "success" && result.data) {
        const normalized = normalizeFinanceData(result.data);
        setData(normalized);
        setTransactionDateFilter((current) => ({
          ...current,
          preset: normalized.settings.defaultDatePreset || "currentMonth"
        }));
        setSyncStatus(result.source === "remote" ? "online" : "local");
      } else {
        setSyncStatus("error");
        showToast(result.message || "Nao foi possivel carregar os dados.", "error", false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [user.username]);

  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
    localStorage.setItem(sessionKeys.theme, data.settings.theme);
  }, [data.settings.theme]);

  const showToast = (message: string, type: ToastType = "success", sound = data.settings.soundEnabled) => {
    setToast({ message, type });
    playTone(sound);
    window.setTimeout(() => setToast(null), 3400);
  };

  const addNotification = (
    draft: FinanceData,
    title: string,
    message: string,
    type: NotificationType = "info",
    key?: string
  ): FinanceData => {
    if (!draft.settings.notificationsEnabled) return draft;
    if (key && draft.notifications.some((item) => item.key === key)) return draft;
    return {
      ...draft,
      notifications: [
        {
          id: makeId(),
          title,
          message,
          type,
          createdAt: new Date().toISOString(),
          read: false,
          key
        },
        ...draft.notifications
      ].slice(0, 80),
      notificationHistory: [
        {
          id: makeId(),
          title,
          message,
          type,
          createdAt: new Date().toISOString(),
          read: false,
          key
        },
        ...draft.notificationHistory
      ].slice(0, 500)
    };
  };

  const evaluateAlerts = (draft: FinanceData): FinanceData => {
    let next = normalizeFinanceData(draft);
    const month = currentMonthKey();
    const today = todayIso();
    const budgetAlertPercent = clamp(Number(next.settings.budgetAlertPercent || 90), 1, 100);
    const voucherAlertPercent = clamp(Number(next.settings.voucherAlertPercent || 15), 1, 100);
    const bigExpenseAlertAmount = Number(next.settings.bigExpenseAlertAmount || 0);
    const upcomingReminderDays = Math.max(0, Number(next.settings.upcomingReminderDays || 3));

    next.budgets
      .filter((budget) => budget.month === month)
      .forEach((budget) => {
        const spent = next.transactions
          .filter((item) => item.type === "expense" && item.category === budget.category && toMonthKey(item.date) === budget.month)
          .reduce((total, item) => total + Number(item.amount || 0), 0);
        const usage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
        if (usage >= 100) {
          next = addNotification(
            next,
            "Orcamento estourado",
            `${budget.category} passou de ${formatCurrency(budget.amount)} em ${budget.month}.`,
            "error",
            `budget-over:${budget.month}:${budget.category}`
          );
        } else if (usage >= budgetAlertPercent) {
          next = addNotification(
            next,
            "Orcamento quase no limite",
            `${budget.category} chegou a ${Math.round(usage)}% do planejado.`,
            "warning",
            `budget-near:${budget.month}:${budget.category}`
          );
        }
      });

    if (bigExpenseAlertAmount > 0) {
      next.transactions
        .filter((item) => item.type === "expense" && Number(item.amount || 0) >= bigExpenseAlertAmount)
        .forEach((item) => {
          next = addNotification(
            next,
            "Despesa alta registrada",
            `${item.description} ficou em ${formatCurrency(item.amount)}.`,
            "warning",
            `big-expense:${item.id}`
          );
        });
    }

    next.vouchers.forEach((voucher) => {
      const available = Number(voucher.total || 0) - Number(voucher.used || 0);
      const ratio = voucher.total > 0 ? available / voucher.total : 1;
      if (voucher.total > 0 && ratio <= voucherAlertPercent / 100) {
        next = addNotification(
          next,
          "Vale perto do fim",
          `${voucher.name} tem ${formatCurrency(Math.max(0, available))} disponivel.`,
          "warning",
          `voucher-low:${currentMonthKey()}:${voucher.id}`
        );
      }
    });

    next.recurrences
      .filter((item) => item.active)
      .forEach((item) => {
        const dueIn = daysBetween(today, item.nextDate);
        if (dueIn >= 0 && dueIn <= upcomingReminderDays) {
          next = addNotification(
            next,
            "Recorrencia chegando",
            dueIn === 0 ? `${item.description} vence hoje.` : `${item.description} vence em ${dueIn} dia(s).`,
            item.type === "expense" ? "warning" : "info",
            `recurrence-due:${item.id}:${item.nextDate}`
          );
        }
      });

    return next;
  };

  const commitData = async (nextData: FinanceData, successMessage: string, options?: { skipAlerts?: boolean }) => {
    const withAlerts = options?.skipAlerts ? normalizeFinanceData(nextData) : evaluateAlerts(nextData);
    setData(withAlerts);
    setSyncStatus("saving");
    const result = await apiService.saveData(user.username, withAlerts);
    if (result.status === "success") {
      setSyncStatus(result.source === "remote" ? "online" : "local");
      showToast(successMessage, result.source === "remote" ? "success" : "warning");
    } else {
      setSyncStatus("error");
      showToast(result.message || "Dados salvos localmente, mas a nuvem falhou.", "warning");
    }
  };

  const resetTransactionForm = () => {
    setEditingTransaction(null);
    setTransactionForm({ description: "", amount: "", type: "expense", category: "Geral", date: todayIso(), note: "" });
  };

  const saveTransaction = (event: FormEvent) => {
    event.preventDefault();
    const amount = parseNumber(transactionForm.amount);
    if (!transactionForm.description.trim() || amount <= 0) {
      showToast("Informe descricao e valor valido.", "warning");
      return;
    }

    const existing = data.transactions.find((item) => item.id === editingTransaction);
    const payload: Transaction = {
      id: editingTransaction || makeId(),
      description: transactionForm.description.trim(),
      amount,
      type: transactionForm.type,
      category: transactionForm.category,
      date: transactionForm.date || todayIso(),
      note: transactionForm.note.trim(),
      createdAt: existing?.createdAt || todayIso(),
      recurrenceId: existing?.recurrenceId
    };

    const transactions = editingTransaction
      ? data.transactions.map((item) => (item.id === editingTransaction ? payload : item))
      : [payload, ...data.transactions];

    resetTransactionForm();
    void commitData({ ...data, transactions }, "Lancamento salvo.");
  };

  const editTransaction = (item: Transaction) => {
    setEditingTransaction(item.id);
    setTransactionForm({
      description: item.description,
      amount: String(item.amount),
      type: item.type,
      category: item.category,
      date: item.date || todayIso(),
      note: item.note || ""
    });
    setView("transactions");
  };

  const deleteTransaction = (id: string) => {
    void commitData({ ...data, transactions: data.transactions.filter((item) => item.id !== id) }, "Lancamento removido.");
  };

  const resetBudgetForm = () => {
    setEditingBudget(null);
    setBudgetForm({ category: "Geral", amount: "", month: currentMonthKey(), rollover: false });
  };

  const saveBudget = (event: FormEvent) => {
    event.preventDefault();
    const amount = parseNumber(budgetForm.amount);
    if (!budgetForm.category || amount <= 0) {
      showToast("Informe categoria e limite valido.", "warning");
      return;
    }

    const existing = data.budgets.find((item) => item.id === editingBudget);
    const duplicate = data.budgets.find(
      (item) => item.id !== editingBudget && item.month === (budgetForm.month || currentMonthKey()) && item.category === budgetForm.category
    );
    const payload: Budget = {
      id: editingBudget || duplicate?.id || makeId(),
      category: budgetForm.category,
      amount,
      month: budgetForm.month || currentMonthKey(),
      rollover: budgetForm.rollover,
      createdAt: existing?.createdAt || duplicate?.createdAt || todayIso()
    };

    const budgets = data.budgets.some((item) => item.id === payload.id)
      ? data.budgets
          .filter((item) => item.id === payload.id || item.id !== duplicate?.id)
          .map((item) => (item.id === payload.id ? payload : item))
      : [payload, ...data.budgets];
    resetBudgetForm();
    setBudgetMonth(payload.month);
    void commitData({ ...data, budgets }, duplicate ? "Orcamento atualizado." : "Orcamento salvo.");
  };

  const editBudget = (item: Budget) => {
    setEditingBudget(item.id);
    setBudgetForm({ category: item.category, amount: String(item.amount), month: item.month, rollover: Boolean(item.rollover) });
    setView("budgets");
  };

  const deleteBudget = (id: string) => {
    void commitData({ ...data, budgets: data.budgets.filter((item) => item.id !== id) }, "Orcamento removido.");
  };

  const resetVoucherForm = () => {
    setEditingVoucher(null);
    setVoucherForm({ name: "", total: "", used: "", autoRenew: true, renewDay: "1" });
  };

  const saveVoucher = (event: FormEvent) => {
    event.preventDefault();
    const total = parseNumber(voucherForm.total);
    const used = parseNumber(voucherForm.used);
    if (!voucherForm.name.trim() || total <= 0) return;

    const existing = data.vouchers.find((item) => item.id === editingVoucher);
    const payload: Voucher = {
      id: editingVoucher || makeId(),
      name: voucherForm.name.trim(),
      total,
      used: Math.min(total, Math.max(0, used)),
      autoRenew: voucherForm.autoRenew,
      renewDay: Math.max(1, Math.min(28, Number(voucherForm.renewDay || 1))),
      createdAt: existing?.createdAt || todayIso(),
      history: existing?.history || []
    };

    const vouchers = editingVoucher
      ? data.vouchers.map((item) => (item.id === editingVoucher ? payload : item))
      : [payload, ...data.vouchers];

    resetVoucherForm();
    void commitData({ ...data, vouchers }, "Vale salvo.");
  };

  const editVoucher = (item: Voucher) => {
    setEditingVoucher(item.id);
    setVoucherForm({
      name: item.name,
      total: String(item.total),
      used: String(item.used),
      autoRenew: Boolean(item.autoRenew),
      renewDay: String(item.renewDay || 1)
    });
    setView("vouchers");
  };

  const useVoucher = (event: FormEvent) => {
    event.preventDefault();
    if (!voucherUseId) return;
    const amount = parseNumber(voucherUseAmount);
    if (amount <= 0) return;
    const voucher = data.vouchers.find((item) => item.id === voucherUseId);
    const available = Number(voucher?.total || 0) - Number(voucher?.used || 0);
    if (!voucher || amount > available) {
      showToast("Uso maior que o saldo disponivel do vale.", "warning");
      return;
    }

    const vouchers = data.vouchers.map((item) => {
      if (item.id !== voucherUseId) return item;
      const used = Number(item.used || 0) + amount;
      return {
        ...item,
        used,
        history: [
          { id: makeId(), amount, date: todayIso(), note: voucherUseNote.trim() },
          ...(item.history || [])
        ].slice(0, 80)
      };
    });

    setVoucherUseId(null);
    setVoucherUseAmount("");
    setVoucherUseNote("");
    void commitData({ ...data, vouchers }, "Uso do vale registrado.");
  };

  const renewVoucher = (id: string) => {
    const vouchers = data.vouchers.map((item) => (item.id === id ? { ...item, used: 0 } : item));
    void commitData({ ...data, vouchers }, "Vale renovado.");
  };

  const deleteVoucher = (id: string) => {
    void commitData({ ...data, vouchers: data.vouchers.filter((item) => item.id !== id) }, "Vale removido.");
  };

  const resetInvestmentForm = () => {
    setEditingInvestment(null);
    setInvestmentForm({ name: "", amount: "", type: "Renda Fixa", isDeductible: false });
  };

  const saveInvestment = (event: FormEvent) => {
    event.preventDefault();
    const amount = parseNumber(investmentForm.amount);
    if (!investmentForm.name.trim() || amount <= 0) return;

    const existing = data.investments.find((item) => item.id === editingInvestment);
    const payload: Investment = {
      id: editingInvestment || makeId(),
      name: investmentForm.name.trim(),
      amount,
      type: investmentForm.type,
      isDeductible: investmentForm.isDeductible,
      createdAt: existing?.createdAt || todayIso()
    };

    const investments = editingInvestment
      ? data.investments.map((item) => (item.id === editingInvestment ? payload : item))
      : [payload, ...data.investments];

    resetInvestmentForm();
    void commitData({ ...data, investments }, "Investimento salvo.");
  };

  const editInvestment = (item: Investment) => {
    setEditingInvestment(item.id);
    setInvestmentForm({
      name: item.name,
      amount: String(item.amount),
      type: item.type,
      isDeductible: Boolean(item.isDeductible)
    });
    setView("investments");
  };

  const deleteInvestment = (id: string) => {
    void commitData(
      {
        ...data,
        investments: data.investments.filter((item) => item.id !== id),
        investmentReturns: data.investmentReturns.filter((item) => item.investmentId !== id)
      },
      "Investimento removido."
    );
  };

  const resetInvestmentReturnForm = () => {
    setEditingInvestmentReturn(null);
    setInvestmentReturnForm({ investmentId: data.investments[0]?.id || "", month: currentMonthKey(), amount: "", percent: "", note: "" });
  };

  const saveInvestmentReturn = (event: FormEvent) => {
    event.preventDefault();
    const investment = data.investments.find((item) => item.id === investmentReturnForm.investmentId);
    const amount = parseNumber(investmentReturnForm.amount);
    const percent = parseNumber(investmentReturnForm.percent);
    if (!investment || (!amount && !percent)) return;

    const existing = data.investmentReturns.find((item) => item.id === editingInvestmentReturn);
    const payload: InvestmentReturn = {
      id: editingInvestmentReturn || makeId(),
      investmentId: investment.id,
      investmentName: investment.name,
      month: investmentReturnForm.month || currentMonthKey(),
      amount,
      percent,
      note: investmentReturnForm.note.trim(),
      createdAt: existing?.createdAt || todayIso()
    };

    const investmentReturns = editingInvestmentReturn
      ? data.investmentReturns.map((item) => (item.id === editingInvestmentReturn ? payload : item))
      : [payload, ...data.investmentReturns];

    resetInvestmentReturnForm();
    void commitData({ ...data, investmentReturns }, "Rentabilidade salva.");
  };

  const editInvestmentReturn = (item: InvestmentReturn) => {
    setEditingInvestmentReturn(item.id);
    setInvestmentReturnForm({
      investmentId: item.investmentId,
      month: item.month,
      amount: String(item.amount),
      percent: String(item.percent),
      note: item.note || ""
    });
    setView("investments");
  };

  const deleteInvestmentReturn = (id: string) => {
    void commitData({ ...data, investmentReturns: data.investmentReturns.filter((item) => item.id !== id) }, "Rentabilidade removida.");
  };

  const resetGoalForm = () => {
    setEditingGoal(null);
    setGoalForm({ name: "", current: "", target: "", targetDate: "" });
  };

  const saveGoal = (event: FormEvent) => {
    event.preventDefault();
    const target = parseNumber(goalForm.target);
    if (!goalForm.name.trim() || target <= 0) return;

    const existing = data.goals.find((item) => item.id === editingGoal);
    const payload: Goal = {
      id: editingGoal || makeId(),
      name: goalForm.name.trim(),
      current: parseNumber(goalForm.current),
      target,
      targetDate: goalForm.targetDate || undefined,
      createdAt: existing?.createdAt || todayIso()
    };

    const goals = editingGoal ? data.goals.map((item) => (item.id === editingGoal ? payload : item)) : [payload, ...data.goals];
    resetGoalForm();
    void commitData({ ...data, goals }, "Meta salva.");
  };

  const editGoal = (item: Goal) => {
    setEditingGoal(item.id);
    setGoalForm({ name: item.name, current: String(item.current), target: String(item.target), targetDate: item.targetDate || "" });
    setView("goals");
  };

  const deleteGoal = (id: string) => {
    void commitData({ ...data, goals: data.goals.filter((item) => item.id !== id) }, "Meta removida.");
  };

  const resetRecurrenceForm = () => {
    setEditingRecurrence(null);
    setRecurrenceForm({
      description: "",
      amount: "",
      type: "expense",
      category: "Geral",
      frequency: "monthly",
      nextDate: todayIso(),
      active: true,
      autoPost: false
    });
  };

  const saveRecurrence = (event: FormEvent) => {
    event.preventDefault();
    const amount = parseNumber(recurrenceForm.amount);
    if (!recurrenceForm.description.trim() || amount <= 0) return;

    const existing = data.recurrences.find((item) => item.id === editingRecurrence);
    const payload: Recurrence = {
      id: editingRecurrence || makeId(),
      description: recurrenceForm.description.trim(),
      amount,
      type: recurrenceForm.type,
      category: recurrenceForm.category,
      frequency: recurrenceForm.frequency,
      nextDate: recurrenceForm.nextDate || todayIso(),
      active: recurrenceForm.active,
      autoPost: recurrenceForm.autoPost,
      createdAt: existing?.createdAt || todayIso()
    };

    const recurrences = editingRecurrence
      ? data.recurrences.map((item) => (item.id === editingRecurrence ? payload : item))
      : [payload, ...data.recurrences];
    resetRecurrenceForm();
    void commitData({ ...data, recurrences }, "Recorrencia salva.");
  };

  const editRecurrence = (item: Recurrence) => {
    setEditingRecurrence(item.id);
    setRecurrenceForm({
      description: item.description,
      amount: String(item.amount),
      type: item.type,
      category: item.category,
      frequency: item.frequency,
      nextDate: item.nextDate,
      active: Boolean(item.active),
      autoPost: Boolean(item.autoPost)
    });
    setView("recurring");
  };

  const deleteRecurrence = (id: string) => {
    void commitData({ ...data, recurrences: data.recurrences.filter((item) => item.id !== id) }, "Recorrencia removida.");
  };

  const postRecurrence = (item: Recurrence) => {
    const transaction = buildTransactionFromRecurrence(item);
    const recurrences = data.recurrences.map((recurrence) =>
      recurrence.id === item.id ? { ...recurrence, nextDate: calculateNextDate(item.nextDate, item.frequency) } : recurrence
    );
    void commitData({ ...data, transactions: [transaction, ...data.transactions], recurrences }, "Recorrencia lancada.");
  };

  const markNotificationRead = (id: string) => {
    const notifications = data.notifications.map((item) => (item.id === id ? { ...item, read: true } : item));
    void commitData({ ...data, notifications }, "Notificacao marcada.", { skipAlerts: true });
  };

  const clearNotifications = () => {
    void commitData({ ...data, notifications: [] }, "Notificacoes limpas.", { skipAlerts: true });
  };

  const updateSettings = (settings: FinanceData["settings"]) => {
    void commitData({ ...data, settings }, "Ajustes salvos.", { skipAlerts: true });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nummi-backup-${todayIso()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Backup exportado.", "success");
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<FinanceData>;
      const normalized = normalizeFinanceData(parsed);
      const totalItems =
        normalized.transactions.length +
        normalized.investments.length +
        normalized.investmentReturns.length +
        normalized.vouchers.length +
        normalized.goals.length +
        normalized.budgets.length +
        normalized.recurrences.length;
      const ok = window.confirm(`Importar backup com ${totalItems} registro(s)? Isso substitui os dados atuais desta conta.`);
      if (!ok) return;
      await commitData(normalized, "Backup importado.");
    } catch {
      showToast("Arquivo invalido para importacao.", "error");
    }
  };

  const exportTransactionsCsv = () => {
    const header = ["description", "amount", "type", "category", "date", "note"];
    const rows = data.transactions.map((item) =>
      [item.description, String(item.amount), item.type, item.category, item.date, item.note || ""]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(";")
    );
    const blob = new Blob([[header.join(";"), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nummi-transacoes-${todayIso()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("CSV exportado.", "success");
  };

  if (syncStatus === "loading") {
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" size={34} />
        <p>Carregando seus dados financeiros...</p>
      </main>
    );
  }

  return (
    <main className={cx("app-shell", data.settings.compactMode && "app-shell--compact")}>
      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}

      <aside className="sidebar">
        <div className="sidebar-brand">
          <WalletCards size={30} />
          <div>
            <strong>{appName}</strong>
            <span>{user.email || user.username}</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map(({ id, icon: Icon, label }) => (
            <button className={cx(view === id && "active")} key={id} onClick={() => setView(id)} type="button">
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-actions">
          <button onClick={() => setPrivacyMode((current) => !current)} type="button">
            {privacyMode ? <Eye size={18} /> : <EyeOff size={18} />}
            {privacyMode ? "Mostrar valores" : "Ocultar valores"}
          </button>
          <button onClick={onLogout} type="button">
            <LogOut size={18} />
            Sair
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p>Controle financeiro</p>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => updateSettings({ ...data.settings, theme: data.settings.theme === "dark" ? "light" : "dark" })} title="Alternar tema" type="button">
              {data.settings.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              aria-label={unreadCount ? `Notificacoes, ${unreadCount} nao lida(s)` : "Notificacoes"}
              className="icon-button"
              onClick={() => setNotificationsOpen((current) => !current)}
              title="Notificacoes"
              type="button"
            >
              {unreadCount ? <BellRing size={18} /> : <Bell size={18} />}
              {unreadCount ? <span>{unreadCount}</span> : null}
            </button>
            <SyncBadge status={syncStatus} />
          </div>
          {notificationsOpen ? (
            <NotificationsPanel
              notifications={data.notifications}
              history={data.notificationHistory}
              onClear={clearNotifications}
              onMarkRead={markNotificationRead}
            />
          ) : null}
        </header>

        {view === "dashboard" ? (
          <DashboardView
            data={data}
            summary={summary}
            expensesByCategory={expensesByCategory}
            investmentsByType={investmentsByType}
            privacyMode={privacyMode}
            onEditGoal={editGoal}
            onSelectView={setView}
          />
        ) : null}

        {view === "transactions" ? (
          <TransactionsView
            form={transactionForm}
            setForm={setTransactionForm}
            transactions={filteredTransactions}
            totalCount={data.transactions.length}
            editingId={editingTransaction}
            privacyMode={privacyMode}
            query={transactionQuery}
            dateFilter={transactionDateFilter}
            dateRangeLabel={transactionRange.label}
            typeFilter={transactionTypeFilter}
            onCancel={resetTransactionForm}
            onDelete={deleteTransaction}
            onEdit={editTransaction}
            onExportCsv={exportTransactionsCsv}
            onSubmit={saveTransaction}
            setDateFilter={setTransactionDateFilter}
            setQuery={setTransactionQuery}
            setTypeFilter={setTransactionTypeFilter}
          />
        ) : null}

        {view === "budgets" ? (
          <BudgetsView
            budgets={data.budgets}
            editingId={editingBudget}
            expenses={data.transactions}
            form={budgetForm}
            month={budgetMonth}
            privacyMode={privacyMode}
            summary={summary}
            onCancel={resetBudgetForm}
            onDelete={deleteBudget}
            onEdit={editBudget}
            onSubmit={saveBudget}
            setForm={setBudgetForm}
            setMonth={setBudgetMonth}
          />
        ) : null}

        {view === "vouchers" ? (
          <VouchersView
            form={voucherForm}
            setForm={setVoucherForm}
            vouchers={data.vouchers}
            editingId={editingVoucher}
            privacyMode={privacyMode}
            usageId={voucherUseId}
            usageAmount={voucherUseAmount}
            usageNote={voucherUseNote}
            vouchersUsage={vouchersUsage}
            onCancel={resetVoucherForm}
            onDelete={deleteVoucher}
            onEdit={editVoucher}
            onRenew={renewVoucher}
            onSubmit={saveVoucher}
            onUseSubmit={useVoucher}
            setUsageAmount={setVoucherUseAmount}
            setUsageId={setVoucherUseId}
            setUsageNote={setVoucherUseNote}
          />
        ) : null}

        {view === "recurring" ? (
          <RecurringView
            editingId={editingRecurrence}
            form={recurrenceForm}
            privacyMode={privacyMode}
            recurrences={data.recurrences}
            onCancel={resetRecurrenceForm}
            onDelete={deleteRecurrence}
            onEdit={editRecurrence}
            onPost={postRecurrence}
            onSubmit={saveRecurrence}
            setForm={setRecurrenceForm}
          />
        ) : null}

        {view === "investments" ? (
          <InvestmentsView
            form={investmentForm}
            setForm={setInvestmentForm}
            returnForm={investmentReturnForm}
            setReturnForm={setInvestmentReturnForm}
            investments={data.investments}
            investmentReturns={data.investmentReturns}
            editingId={editingInvestment}
            editingReturnId={editingInvestmentReturn}
            investmentsByType={investmentsByType}
            returnsByMonth={investmentReturnsByMonth}
            privacyMode={privacyMode}
            onCancel={resetInvestmentForm}
            onCancelReturn={resetInvestmentReturnForm}
            onDelete={deleteInvestment}
            onDeleteReturn={deleteInvestmentReturn}
            onEdit={editInvestment}
            onEditReturn={editInvestmentReturn}
            onSubmit={saveInvestment}
            onSubmitReturn={saveInvestmentReturn}
          />
        ) : null}

        {view === "goals" ? (
          <GoalsView
            form={goalForm}
            setForm={setGoalForm}
            goals={data.goals}
            editingId={editingGoal}
            privacyMode={privacyMode}
            onCancel={resetGoalForm}
            onDelete={deleteGoal}
            onEdit={editGoal}
            onSubmit={saveGoal}
          />
        ) : null}

        {view === "reports" ? (
          <ReportsView
            data={data}
            summary={summary}
            expensesByCategory={expensesByCategory}
            currentExpensesByCategory={currentExpensesByCategory}
            privacyMode={privacyMode}
            month={budgetMonth}
            setMonth={setBudgetMonth}
          />
        ) : null}

        {view === "settings" ? (
          <SettingsView
            data={data}
            privacyMode={privacyMode}
            user={user}
            onExport={exportJson}
            onImport={importJson}
            onLogout={onLogout}
            onPrivacyChange={setPrivacyMode}
            onSettingsChange={(settings) => updateSettings(settings)}
          />
        ) : null}
      </section>
    </main>
  );
}

function viewTitle(view: View) {
  const titles: Record<View, string> = {
    dashboard: "Visao Geral",
    transactions: "Transacoes",
    budgets: "Orcamentos",
    vouchers: "Gestao de Vales",
    recurring: "Recorrencias",
    investments: "Carteira",
    goals: "Metas",
    reports: "Relatorios",
    settings: "Ajustes"
  };
  return titles[view];
}

function SyncBadge({ status }: { status: SyncStatus }) {
  if (status === "saving") {
    return (
      <span className="sync-badge sync-badge--saving">
        <LoaderCircle className="spin" size={16} />
        Salvando
      </span>
    );
  }

  if (status === "online") {
    return (
      <span className="sync-badge sync-badge--online">
        <Cloud size={16} />
        Sincronizado
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="sync-badge sync-badge--error">
        <CloudOff size={16} />
        Nuvem indisponivel
      </span>
    );
  }

  return (
    <span className="sync-badge sync-badge--local">
      <CloudOff size={16} />
      Modo local{hasRemoteBackend ? " / fallback" : ""}
    </span>
  );
}

function NotificationsPanel({
  history,
  notifications,
  onClear,
  onMarkRead
}: {
  history: NotificationItem[];
  notifications: NotificationItem[];
  onClear: () => void;
  onMarkRead: (id: string) => void;
}) {
  const activeKeys = new Set(notifications.map((item) => item.key || item.id));
  const visibleHistory = history.filter((item) => !activeKeys.has(item.key || item.id));

  return (
    <section className="notifications-panel">
      <div className="panel-title">
        <h2>Notificacoes</h2>
        {notifications.length ? (
          <button className="ghost-button" onClick={onClear} type="button">
            Limpar
          </button>
        ) : null}
      </div>
      {notifications.length ? (
        <div className="notification-list">
          {notifications.slice(0, 12).map((item) => (
            <button className={cx("notification-item", !item.read && "unread", `notification-item--${item.type}`)} key={item.id} onClick={() => onMarkRead(item.id)} type="button">
              <strong>{item.title}</strong>
              <span>{item.message}</span>
              <small>{new Date(item.createdAt).toLocaleString("pt-BR")}</small>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="Tudo limpo por aqui." />
      )}
      {visibleHistory.length ? (
        <div className="notification-history">
          <h3>Historico recente</h3>
          {visibleHistory.slice(0, 8).map((item) => (
            <div className={cx("notification-item", `notification-item--${item.type}`)} key={`${item.id}-history`}>
              <strong>{item.title}</strong>
              <span>{item.message}</span>
              <small>{new Date(item.createdAt).toLocaleString("pt-BR")}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DashboardView({
  data,
  summary,
  expensesByCategory,
  investmentsByType,
  privacyMode,
  onEditGoal,
  onSelectView
}: {
  data: FinanceData;
  summary: FinancialSummary;
  expensesByCategory: Array<{ label: string; value: number }>;
  investmentsByType: Array<{ label: string; value: number }>;
  privacyMode: boolean;
  onEditGoal: (goal: Goal) => void;
  onSelectView: (view: View) => void;
}) {
  const upcoming = data.recurrences
    .filter((item) => item.active)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 5);

  return (
    <div className="page-grid">
      <div className="metric-grid">
        <MetricCard label="Entradas" value={summary.income} icon={TrendingUp} tone="good" privacyMode={privacyMode} />
        <MetricCard label="Saidas" value={summary.expense} icon={TrendingDown} tone="bad" privacyMode={privacyMode} />
        <MetricCard label="Saldo livre" value={summary.balance} icon={WalletCards} tone="blue" privacyMode={privacyMode} />
        <MetricCard label="Patrimonio estimado" value={summary.netWorth} icon={PiggyBank} tone="warm" privacyMode={privacyMode} />
      </div>

      <section className="panel">
        <div className="panel-title">
          <h2>Gastos por categoria</h2>
          <BarChart3 size={18} />
        </div>
        <PieChart data={expensesByCategory} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Carteira</h2>
          <PiggyBank size={18} />
        </div>
        <PieChart data={investmentsByType} />
      </section>

      <section className="panel panel--wide">
        <div className="panel-title">
          <h2>Ultimos lancamentos</h2>
          <button className="ghost-button" onClick={() => onSelectView("transactions")} type="button">
            Ver todos
          </button>
        </div>
        {data.transactions.length ? (
          <div className="simple-list">
            {data.transactions.slice(0, 7).map((item) => (
              <div key={item.id}>
                <span className={cx("dot", item.type === "income" ? "dot--good" : "dot--bad")} />
                <p>{item.description}</p>
                <small>{item.category}</small>
                <strong>{maskValue(formatCurrency(item.amount), privacyMode)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Nenhum lancamento ainda." action="Cadastre entradas e saidas para gerar a visao geral." />
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Proximas recorrencias</h2>
          <button className="ghost-button" onClick={() => onSelectView("recurring")} type="button">
            Gerenciar
          </button>
        </div>
        {upcoming.length ? (
          <div className="mini-list">
            {upcoming.map((item) => (
              <div key={item.id}>
                <span className={cx("item-icon", item.type === "income" ? "item-icon--good" : "item-icon--bad")}>
                  <Repeat2 size={16} />
                </span>
                <p>{item.description}</p>
                <strong>{formatDate(item.nextDate)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sem recorrencias ativas." />
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Metas ativas</h2>
          <button className="ghost-button" onClick={() => onSelectView("goals")} type="button">
            Nova meta
          </button>
        </div>
        {data.goals.length ? (
          <div className="goal-list">
            {data.goals.slice(0, 4).map((goal) => (
              <button key={goal.id} onClick={() => onEditGoal(goal)} type="button">
                <span>{goal.name}</span>
                <strong>{maskValue(`${formatCurrency(goal.current)} / ${formatCurrency(goal.target)}`, privacyMode)}</strong>
                <ProgressBar current={goal.current} total={goal.target} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="Sem metas cadastradas." />
        )}
      </section>
    </div>
  );
}

function TransactionsView({
  form,
  setForm,
  transactions,
  totalCount,
  editingId,
  privacyMode,
  query,
  dateFilter,
  dateRangeLabel,
  typeFilter,
  onCancel,
  onDelete,
  onEdit,
  onExportCsv,
  onSubmit,
  setDateFilter,
  setQuery,
  setTypeFilter
}: {
  form: { description: string; amount: string; type: TransactionType; category: string; date: string; note: string };
  setForm: (form: { description: string; amount: string; type: TransactionType; category: string; date: string; note: string }) => void;
  transactions: Transaction[];
  totalCount: number;
  editingId: string | null;
  privacyMode: boolean;
  query: string;
  dateFilter: DateFilterState;
  dateRangeLabel: string;
  typeFilter: "all" | TransactionType;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: Transaction) => void;
  onExportCsv: () => void;
  onSubmit: (event: FormEvent) => void;
  setDateFilter: (value: DateFilterState) => void;
  setQuery: (value: string) => void;
  setTypeFilter: (value: "all" | TransactionType) => void;
}) {
  return (
    <div className="split-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>{editingId ? "Editar lancamento" : "Novo lancamento"}</h2>
          <Plus size={18} />
        </div>
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            Nome
            <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
          </label>
          <label>
            Valor
            <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} inputMode="decimal" required />
          </label>
          <label>
            Data
            <input value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} type="date" />
          </label>
          <label>
            Categoria
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            Observacao
            <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </label>
          <div className="segmented">
            <button className={cx(form.type === "income" && "active")} onClick={() => setForm({ ...form, type: "income" })} type="button">
              Entrada
            </button>
            <button className={cx(form.type === "expense" && "active")} onClick={() => setForm({ ...form, type: "expense" })} type="button">
              Saida
            </button>
          </div>
          <div className="button-row">
            {editingId ? (
              <button className="secondary-button" onClick={onCancel} type="button">
                Cancelar
              </button>
            ) : null}
            <button className="primary-button" type="submit">
              <Save size={18} />
              Salvar
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Historico</h2>
          <span>{transactions.length} de {totalCount}</span>
        </div>
        <div className="filter-toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | TransactionType)}>
            <option value="all">Todos</option>
            <option value="income">Entradas</option>
            <option value="expense">Saidas</option>
          </select>
          <button className="secondary-button" onClick={onExportCsv} type="button">
            <Download size={16} />
            CSV
          </button>
        </div>
        <div className="date-filter-panel">
          <div className="date-preset-row">
            {datePresets.map((preset) => (
              <button
                className={cx(dateFilter.preset === preset.id && "active")}
                key={preset.id}
                onClick={() => setDateFilter({ ...dateFilter, preset: preset.id })}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
          {dateFilter.preset === "custom" ? (
            <div className="date-custom-row">
              <label>
                Inicio
                <input value={dateFilter.start} onChange={(event) => setDateFilter({ ...dateFilter, start: event.target.value })} type="date" />
              </label>
              <label>
                Fim
                <input value={dateFilter.end} onChange={(event) => setDateFilter({ ...dateFilter, end: event.target.value })} type="date" />
              </label>
            </div>
          ) : null}
          <span>{dateRangeLabel}</span>
        </div>
        {transactions.length ? (
          <div className="table-list">
            {transactions.map((item) => (
              <article key={item.id} className="row-card">
                <div>
                  <span className={cx("item-icon", item.type === "income" ? "item-icon--good" : "item-icon--bad")}>
                    {item.type === "income" ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
                  </span>
                  <div>
                    <strong>{item.description}</strong>
                    <p>
                      {item.category} | {formatDate(item.date)}
                    </p>
                    {item.note ? <small>{item.note}</small> : null}
                  </div>
                </div>
                <aside>
                  <strong className={item.type === "income" ? "money-good" : "money-bad"}>
                    {item.type === "expense" ? "- " : ""}
                    {maskValue(formatCurrency(item.amount), privacyMode)}
                  </strong>
                  <div className="icon-actions">
                    <button onClick={() => onEdit(item)} title="Editar" type="button">
                      <Edit3 size={16} />
                    </button>
                    <button onClick={() => onDelete(item.id)} title="Apagar" type="button">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </aside>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Nenhuma transacao encontrada." />
        )}
      </section>
    </div>
  );
}

function BudgetsView({
  budgets,
  editingId,
  expenses,
  form,
  month,
  privacyMode,
  summary,
  onCancel,
  onDelete,
  onEdit,
  onSubmit,
  setForm,
  setMonth
}: {
  budgets: Budget[];
  editingId: string | null;
  expenses: Transaction[];
  form: { category: string; amount: string; month: string; rollover: boolean };
  month: string;
  privacyMode: boolean;
  summary: FinancialSummary;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: Budget) => void;
  onSubmit: (event: FormEvent) => void;
  setForm: (form: { category: string; amount: string; month: string; rollover: boolean }) => void;
  setMonth: (value: string) => void;
}) {
  const monthBudgets = budgets.filter((item) => item.month === month);

  return (
    <div className="split-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>{editingId ? "Editar orcamento" : "Novo orcamento"}</h2>
          <ClipboardList size={18} />
        </div>
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            Mes
            <input value={form.month} onChange={(event) => setForm({ ...form, month: event.target.value })} type="month" required />
          </label>
          <label>
            Categoria
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            Limite
            <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} inputMode="decimal" required />
          </label>
          <label className="check-row">
            <input checked={form.rollover} onChange={(event) => setForm({ ...form, rollover: event.target.checked })} type="checkbox" />
            Considerar sobra/estouro no mes seguinte
          </label>
          <div className="button-row">
            {editingId ? (
              <button className="secondary-button" onClick={onCancel} type="button">
                Cancelar
              </button>
            ) : null}
            <button className="primary-button" type="submit">
              <Save size={18} />
              Salvar
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Controle mensal</h2>
          <input className="compact-input" value={month} onChange={(event) => setMonth(event.target.value)} type="month" />
        </div>
        <div className="mini-metrics">
          <div>
            <span>Planejado</span>
            <strong>{maskValue(formatCurrency(summary.budgeted), privacyMode)}</strong>
          </div>
          <div>
            <span>Gasto</span>
            <strong>{maskValue(formatCurrency(summary.budgetSpent), privacyMode)}</strong>
          </div>
          <div>
            <span>Restante</span>
            <strong>{maskValue(formatCurrency(summary.budgetRemaining), privacyMode)}</strong>
          </div>
        </div>
        {monthBudgets.length ? (
          <div className="budget-list">
            {monthBudgets.map((budget) => {
              const spent = expenses
                .filter((item) => item.type === "expense" && item.category === budget.category && toMonthKey(item.date) === budget.month)
                .reduce((total, item) => total + Number(item.amount || 0), 0);
              const over = spent > budget.amount;
              return (
                <article key={budget.id} className={cx("budget-card", over && "budget-card--over")}>
                  <div className="goal-row">
                    <strong>{budget.category}</strong>
                    <div className="icon-actions">
                      <button onClick={() => onEdit(budget)} title="Editar" type="button">
                        <Edit3 size={16} />
                      </button>
                      <button onClick={() => onDelete(budget.id)} title="Apagar" type="button">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <p>{maskValue(`${formatCurrency(spent)} / ${formatCurrency(budget.amount)}`, privacyMode)}</p>
                  <ProgressBar current={spent} total={budget.amount} warn={over} />
                  <small>{over ? "Acima do limite" : `${Math.round(clamp((spent / budget.amount) * 100))}% usado`}</small>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="Nenhum orcamento para este mes." />
        )}
      </section>
    </div>
  );
}

function VouchersView({
  form,
  setForm,
  vouchers,
  editingId,
  privacyMode,
  usageId,
  usageAmount,
  usageNote,
  vouchersUsage,
  onCancel,
  onDelete,
  onEdit,
  onRenew,
  onSubmit,
  onUseSubmit,
  setUsageAmount,
  setUsageId,
  setUsageNote
}: {
  form: { name: string; total: string; used: string; autoRenew: boolean; renewDay: string };
  setForm: (form: { name: string; total: string; used: string; autoRenew: boolean; renewDay: string }) => void;
  vouchers: Voucher[];
  editingId: string | null;
  privacyMode: boolean;
  usageId: string | null;
  usageAmount: string;
  usageNote: string;
  vouchersUsage: Array<{ label: string; value: number }>;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: Voucher) => void;
  onRenew: (id: string) => void;
  onSubmit: (event: FormEvent) => void;
  onUseSubmit: (event: FormEvent) => void;
  setUsageAmount: (value: string) => void;
  setUsageId: (id: string | null) => void;
  setUsageNote: (value: string) => void;
}) {
  return (
    <div className="split-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>{editingId ? "Editar vale" : "Novo vale"}</h2>
          <CreditCard size={18} />
        </div>
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            Nome
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            Valor total
            <input value={form.total} onChange={(event) => setForm({ ...form, total: event.target.value })} inputMode="decimal" required />
          </label>
          <label>
            Ja usado
            <input value={form.used} onChange={(event) => setForm({ ...form, used: event.target.value })} inputMode="decimal" />
          </label>
          <label className="check-row">
            <input checked={form.autoRenew} onChange={(event) => setForm({ ...form, autoRenew: event.target.checked })} type="checkbox" />
            Renovar automaticamente no controle mensal
          </label>
          <label>
            Dia de renovacao
            <input value={form.renewDay} onChange={(event) => setForm({ ...form, renewDay: event.target.value })} min={1} max={28} type="number" />
          </label>
          <div className="button-row">
            {editingId ? (
              <button className="secondary-button" onClick={onCancel} type="button">
                Cancelar
              </button>
            ) : null}
            <button className="primary-button" type="submit">
              <Save size={18} />
              Salvar vale
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Vales cadastrados</h2>
          <span>{vouchers.length} itens</span>
        </div>
        {vouchers.length ? (
          <div className="voucher-grid">
            {vouchers.map((voucher) => {
              const available = Number(voucher.total || 0) - Number(voucher.used || 0);
              return (
                <article className="voucher-card" key={voucher.id}>
                  <div className="voucher-head">
                    <div>
                      <strong>{voucher.name}</strong>
                      <p>Total {maskValue(formatCurrency(voucher.total), privacyMode)}</p>
                    </div>
                    <div className="icon-actions">
                      <button onClick={() => onEdit(voucher)} title="Editar" type="button">
                        <Edit3 size={16} />
                      </button>
                      <button onClick={() => onDelete(voucher.id)} title="Apagar" type="button">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <strong className="voucher-balance">{maskValue(formatCurrency(available), privacyMode)}</strong>
                  <span>Disponivel</span>
                  <ProgressBar current={voucher.used} total={voucher.total} warn={available < 0} />
                  <div className="button-row">
                    <button className="secondary-button" onClick={() => setUsageId(voucher.id)} type="button">
                      Registrar uso
                    </button>
                    <button className="ghost-button" onClick={() => onRenew(voucher.id)} type="button">
                      Renovar
                    </button>
                  </div>
                  {voucher.history.length ? <small>{voucher.history.length} uso(s) registrados</small> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="Nenhum vale cadastrado." />
        )}
        {vouchers.length ? (
          <div className="chart-section">
            <h3>Uso por vale</h3>
            <PieChart data={vouchersUsage} />
          </div>
        ) : null}
      </section>

      {usageId ? (
        <div className="modal-backdrop">
          <form className="modal-card" onSubmit={onUseSubmit}>
            <h2>Registrar uso do vale</h2>
            <label>
              Valor usado
              <input value={usageAmount} onChange={(event) => setUsageAmount(event.target.value)} inputMode="decimal" autoFocus required />
            </label>
            <label>
              Observacao
              <input value={usageNote} onChange={(event) => setUsageNote(event.target.value)} />
            </label>
            <div className="button-row">
              <button className="secondary-button" onClick={() => setUsageId(null)} type="button">
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                Confirmar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function RecurringView({
  editingId,
  form,
  privacyMode,
  recurrences,
  onCancel,
  onDelete,
  onEdit,
  onPost,
  onSubmit,
  setForm
}: {
  editingId: string | null;
  form: {
    description: string;
    amount: string;
    type: TransactionType;
    category: string;
    frequency: RecurrenceFrequency;
    nextDate: string;
    active: boolean;
    autoPost: boolean;
  };
  privacyMode: boolean;
  recurrences: Recurrence[];
  onCancel: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: Recurrence) => void;
  onPost: (item: Recurrence) => void;
  onSubmit: (event: FormEvent) => void;
  setForm: (form: {
    description: string;
    amount: string;
    type: TransactionType;
    category: string;
    frequency: RecurrenceFrequency;
    nextDate: string;
    active: boolean;
    autoPost: boolean;
  }) => void;
}) {
  const sorted = [...recurrences].sort((a, b) => a.nextDate.localeCompare(b.nextDate));

  return (
    <div className="split-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>{editingId ? "Editar recorrencia" : "Nova recorrencia"}</h2>
          <Repeat2 size={18} />
        </div>
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            Descricao
            <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
          </label>
          <label>
            Valor
            <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} inputMode="decimal" required />
          </label>
          <label>
            Proxima data
            <input value={form.nextDate} onChange={(event) => setForm({ ...form, nextDate: event.target.value })} type="date" required />
          </label>
          <label>
            Categoria
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            Frequencia
            <select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value as RecurrenceFrequency })}>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensal</option>
              <option value="yearly">Anual</option>
            </select>
          </label>
          <div className="segmented">
            <button className={cx(form.type === "income" && "active")} onClick={() => setForm({ ...form, type: "income" })} type="button">
              Entrada
            </button>
            <button className={cx(form.type === "expense" && "active")} onClick={() => setForm({ ...form, type: "expense" })} type="button">
              Saida
            </button>
          </div>
          <label className="check-row">
            <input checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} type="checkbox" />
            Recorrencia ativa
          </label>
          <label className="check-row">
            <input checked={form.autoPost} onChange={(event) => setForm({ ...form, autoPost: event.target.checked })} type="checkbox" />
            Permitir lancamento automatico no Apps Script
          </label>
          <div className="button-row">
            {editingId ? (
              <button className="secondary-button" onClick={onCancel} type="button">
                Cancelar
              </button>
            ) : null}
            <button className="primary-button" type="submit">
              <Save size={18} />
              Salvar
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Agenda financeira</h2>
          <span>{recurrences.length} itens</span>
        </div>
        {sorted.length ? (
          <div className="table-list">
            {sorted.map((item) => (
              <article className={cx("row-card", !item.active && "row-card--muted")} key={item.id}>
                <div>
                  <span className={cx("item-icon", item.type === "income" ? "item-icon--good" : "item-icon--bad")}>
                    <Repeat2 size={17} />
                  </span>
                  <div>
                    <strong>{item.description}</strong>
                    <p>
                      {item.category} | {formatDate(item.nextDate)} | {frequencyLabels[item.frequency] || item.frequency}
                    </p>
                    {item.autoPost ? <small>Automatico no backend</small> : null}
                  </div>
                </div>
                <aside>
                  <strong className={item.type === "income" ? "money-good" : "money-bad"}>
                    {maskValue(formatCurrency(item.amount), privacyMode)}
                  </strong>
                  <div className="icon-actions">
                    <button onClick={() => onPost(item)} title="Lancar agora" type="button">
                      <Plus size={16} />
                    </button>
                    <button onClick={() => onEdit(item)} title="Editar" type="button">
                      <Edit3 size={16} />
                    </button>
                    <button onClick={() => onDelete(item.id)} title="Apagar" type="button">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </aside>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Nenhuma recorrencia cadastrada." />
        )}
      </section>
    </div>
  );
}

function InvestmentsView({
  form,
  setForm,
  returnForm,
  setReturnForm,
  investments,
  investmentReturns,
  editingId,
  editingReturnId,
  investmentsByType,
  returnsByMonth,
  privacyMode,
  onCancel,
  onCancelReturn,
  onDelete,
  onDeleteReturn,
  onEdit,
  onEditReturn,
  onSubmit,
  onSubmitReturn
}: {
  form: { name: string; amount: string; type: string; isDeductible: boolean };
  setForm: (form: { name: string; amount: string; type: string; isDeductible: boolean }) => void;
  returnForm: { investmentId: string; month: string; amount: string; percent: string; note: string };
  setReturnForm: (form: { investmentId: string; month: string; amount: string; percent: string; note: string }) => void;
  investments: Investment[];
  investmentReturns: InvestmentReturn[];
  editingId: string | null;
  editingReturnId: string | null;
  investmentsByType: Array<{ label: string; value: number }>;
  returnsByMonth: Array<{ label: string; value: number }>;
  privacyMode: boolean;
  onCancel: () => void;
  onCancelReturn: () => void;
  onDelete: (id: string) => void;
  onDeleteReturn: (id: string) => void;
  onEdit: (item: Investment) => void;
  onEditReturn: (item: InvestmentReturn) => void;
  onSubmit: (event: FormEvent) => void;
  onSubmitReturn: (event: FormEvent) => void;
}) {
  const returnsTotal = investmentReturns.reduce((total, item) => total + Number(item.amount || 0), 0);
  const currentMonthReturn = investmentReturns
    .filter((item) => item.month === currentMonthKey())
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  return (
    <div className="split-layout">
      <div className="stack-layout">
        <section className="panel">
          <div className="panel-title">
            <h2>{editingId ? "Editar ativo" : "Novo ativo"}</h2>
            <PiggyBank size={18} />
          </div>
          <form className="form-stack" onSubmit={onSubmit}>
            <label>
              Nome do ativo
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
            <label>
              Valor atual
              <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} inputMode="decimal" required />
            </label>
            <label>
              Tipo
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                {investmentTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="check-row">
              <input checked={form.isDeductible} onChange={(event) => setForm({ ...form, isDeductible: event.target.checked })} type="checkbox" />
              Deduzir do saldo livre
            </label>
            <div className="button-row">
              {editingId ? (
                <button className="secondary-button" onClick={onCancel} type="button">
                  Cancelar
                </button>
              ) : null}
              <button className="primary-button" type="submit">
                <Save size={18} />
                Salvar ativo
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>{editingReturnId ? "Editar rentabilidade" : "Rentabilidade mensal"}</h2>
            <TrendingUp size={18} />
          </div>
          <form className="form-stack" onSubmit={onSubmitReturn}>
            <label>
              Ativo
              <select
                value={returnForm.investmentId}
                onChange={(event) => setReturnForm({ ...returnForm, investmentId: event.target.value })}
                required
              >
                <option value="">Selecione</option>
                {investments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mes
              <input value={returnForm.month} onChange={(event) => setReturnForm({ ...returnForm, month: event.target.value })} type="month" required />
            </label>
            <div className="inline-fields">
              <label>
                Resultado R$
                <input value={returnForm.amount} onChange={(event) => setReturnForm({ ...returnForm, amount: event.target.value })} inputMode="decimal" />
              </label>
              <label>
                Resultado %
                <input value={returnForm.percent} onChange={(event) => setReturnForm({ ...returnForm, percent: event.target.value })} inputMode="decimal" />
              </label>
            </div>
            <label>
              Observacao
              <input value={returnForm.note} onChange={(event) => setReturnForm({ ...returnForm, note: event.target.value })} />
            </label>
            <div className="button-row">
              {editingReturnId ? (
                <button className="secondary-button" onClick={onCancelReturn} type="button">
                  Cancelar
                </button>
              ) : null}
              <button className="primary-button" disabled={!investments.length} type="submit">
                <Save size={18} />
                Salvar retorno
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="panel">
        <div className="panel-title">
          <h2>Carteira</h2>
          <span>{investments.length} itens</span>
        </div>
        <div className="mini-metrics">
          <div>
            <span>Retorno do mes</span>
            <strong>{maskValue(formatCurrency(currentMonthReturn), privacyMode)}</strong>
          </div>
          <div>
            <span>Retorno acumulado</span>
            <strong>{maskValue(formatCurrency(returnsTotal), privacyMode)}</strong>
          </div>
          <div>
            <span>Registros</span>
            <strong>{investmentReturns.length}</strong>
          </div>
        </div>
        {investments.length ? (
          <div className="card-grid">
            {investments.map((item) => {
              const itemReturns = investmentReturns.filter((entry) => entry.investmentId === item.id);
              const itemReturnTotal = itemReturns.reduce((total, entry) => total + Number(entry.amount || 0), 0);
              const lastReturn = itemReturns.sort((a, b) => b.month.localeCompare(a.month))[0];
              return (
                <article className="asset-card" key={item.id}>
                  <div className="asset-top">
                    <span>{item.type}</span>
                    <div className="icon-actions">
                      <button onClick={() => onEdit(item)} title="Editar" type="button">
                        <Edit3 size={16} />
                      </button>
                      <button onClick={() => onDelete(item.id)} title="Apagar" type="button">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <strong>{item.name}</strong>
                  <p>{maskValue(formatCurrency(item.amount), privacyMode)}</p>
                  <div className="asset-return">
                    <span>Retorno acumulado</span>
                    <strong className={itemReturnTotal >= 0 ? "money-good" : "money-bad"}>
                      {maskValue(formatCurrency(itemReturnTotal), privacyMode)}
                    </strong>
                  </div>
                  {lastReturn ? <small>Ultimo: {lastReturn.month} | {lastReturn.percent || 0}%</small> : null}
                  {item.isDeductible ? <em>Deduzido do saldo livre</em> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="Nenhum investimento cadastrado." />
        )}
        {investmentReturns.length ? (
          <div className="chart-section">
            <h3>Historico de rentabilidade</h3>
            <div className="table-list">
              {investmentReturns.slice(0, 8).map((item) => (
                <article className="row-card" key={item.id}>
                  <div>
                    <span className={cx("item-icon", item.amount >= 0 ? "item-icon--good" : "item-icon--bad")}>
                      {item.amount >= 0 ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
                    </span>
                    <div>
                      <strong>{item.investmentName}</strong>
                      <p>
                        {item.month} | {item.percent || 0}%
                      </p>
                      {item.note ? <small>{item.note}</small> : null}
                    </div>
                  </div>
                  <aside>
                    <strong className={item.amount >= 0 ? "money-good" : "money-bad"}>
                      {maskValue(formatCurrency(item.amount), privacyMode)}
                    </strong>
                    <div className="icon-actions">
                      <button onClick={() => onEditReturn(item)} title="Editar" type="button">
                        <Edit3 size={16} />
                      </button>
                      <button onClick={() => onDeleteReturn(item.id)} title="Apagar" type="button">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </aside>
                </article>
              ))}
            </div>
          </div>
        ) : null}
        {investments.length ? (
          <div className="chart-section">
            <h3>Distribuicao da carteira</h3>
            <PieChart data={investmentsByType} />
          </div>
        ) : null}
        {returnsByMonth.length ? (
          <div className="chart-section">
            <h3>Retorno por mes</h3>
            <PieChart data={returnsByMonth.map((item) => ({ ...item, value: Math.abs(item.value) }))} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function GoalsView({
  form,
  setForm,
  goals,
  editingId,
  privacyMode,
  onCancel,
  onDelete,
  onEdit,
  onSubmit
}: {
  form: { name: string; current: string; target: string; targetDate: string };
  setForm: (form: { name: string; current: string; target: string; targetDate: string }) => void;
  goals: Goal[];
  editingId: string | null;
  privacyMode: boolean;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onEdit: (item: Goal) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="split-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>{editingId ? "Editar meta" : "Nova meta"}</h2>
          <Target size={18} />
        </div>
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            Nome da meta
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            Valor atual
            <input value={form.current} onChange={(event) => setForm({ ...form, current: event.target.value })} inputMode="decimal" />
          </label>
          <label>
            Valor alvo
            <input value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} inputMode="decimal" required />
          </label>
          <label>
            Data alvo
            <input value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} type="date" />
          </label>
          <div className="button-row">
            {editingId ? (
              <button className="secondary-button" onClick={onCancel} type="button">
                Cancelar
              </button>
            ) : null}
            <button className="primary-button" type="submit">
              <Save size={18} />
              Salvar meta
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Minhas metas</h2>
          <span>{goals.length} itens</span>
        </div>
        {goals.length ? (
          <div className="goal-list">
            {goals.map((goal) => {
              const remaining = Math.max(0, goal.target - goal.current);
              return (
                <article key={goal.id}>
                  <div className="goal-row">
                    <strong>{goal.name}</strong>
                    <div className="icon-actions">
                      <button onClick={() => onEdit(goal)} title="Editar" type="button">
                        <Edit3 size={16} />
                      </button>
                      <button onClick={() => onDelete(goal.id)} title="Apagar" type="button">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <p>{maskValue(`${formatCurrency(goal.current)} / ${formatCurrency(goal.target)}`, privacyMode)}</p>
                  <ProgressBar current={goal.current} total={goal.target} />
                  <small>
                    Falta {maskValue(formatCurrency(remaining), privacyMode)}
                    {goal.targetDate ? ` | ate ${formatDate(goal.targetDate)}` : ""}
                  </small>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="Nenhuma meta cadastrada." />
        )}
      </section>
    </div>
  );
}

function ReportsView({
  data,
  summary,
  expensesByCategory,
  currentExpensesByCategory,
  privacyMode,
  month,
  setMonth
}: {
  data: FinanceData;
  summary: FinancialSummary;
  expensesByCategory: Array<{ label: string; value: number }>;
  currentExpensesByCategory: Array<{ label: string; value: number }>;
  privacyMode: boolean;
  month: string;
  setMonth: (value: string) => void;
}) {
  const healthScore = clamp(
    70 +
      (summary.balance >= 0 ? 12 : -20) +
      (summary.savingsRate >= 20 ? 10 : summary.savingsRate >= 5 ? 4 : -8) +
      (summary.budgeted > 0 ? 5 : -4) +
      (data.recurrences.length > 0 ? 3 : 0)
  );
  const topCategory = expensesByCategory[0];
  const overBudgets = data.budgets.filter((budget) => {
    const spent = data.transactions
      .filter((item) => item.type === "expense" && item.category === budget.category && toMonthKey(item.date) === budget.month)
      .reduce((total, item) => total + item.amount, 0);
    return spent > budget.amount;
  });

  const insights = [
    summary.income <= 0 ? "Cadastre entradas recorrentes ou pontuais para medir economia real." : null,
    summary.balance < 0 ? "O fluxo esta negativo. Revise categorias acima do limite e recorrencias de despesa." : null,
    summary.budgeted <= 0 ? "Crie orcamentos mensais para as categorias principais e acompanhar estouros antes do fim do mes." : null,
    topCategory ? `Maior categoria de gasto: ${topCategory.label}, com ${formatCurrency(topCategory.value)}.` : null,
    summary.upcomingExpenses > 0 ? `Proximos 30 dias tem ${formatCurrency(summary.upcomingExpenses)} em recorrencias de saida.` : null,
    summary.investmentReturnMonth !== 0
      ? `Rentabilidade registrada no mes: ${formatCurrency(summary.investmentReturnMonth)} (${summary.investmentReturnPercent}%).`
      : null,
    overBudgets.length ? `${overBudgets.length} orcamento(s) estourado(s). Priorize corrigir esses limites.` : null,
    data.goals.length ? `Metas somam ${formatCurrency(summary.goalsCurrent)} de ${formatCurrency(summary.goalsTarget)}.` : null
  ].filter(Boolean) as string[];

  return (
    <div className="reports-layout">
      <section className="report-hero">
        <div>
          <span>Relatorio local</span>
          <h2>{Math.round(healthScore)} pontos</h2>
          <p>Indicador gerado no navegador, sem consumir token ou chamar servico externo.</p>
        </div>
        <BarChart3 size={44} />
      </section>

      <div className="metric-grid">
        <section className="metric-card metric-card--good">
          <div>
            <span>Taxa de economia</span>
            <strong>{summary.income > 0 ? `${summary.savingsRate}%` : "Sem base"}</strong>
          </div>
          <TrendingUp size={24} />
        </section>
        <MetricCard label="Recorrencias de entrada" value={summary.recurringIncome} icon={Repeat2} tone="blue" privacyMode={privacyMode} />
        <MetricCard label="Recorrencias de saida" value={summary.recurringExpense} icon={Repeat2} tone="bad" privacyMode={privacyMode} />
        <MetricCard label="Retorno do mes" value={summary.investmentReturnMonth} icon={PiggyBank} tone="warm" privacyMode={privacyMode} />
      </div>

      <section className="panel">
        <div className="panel-title">
          <h2>Leitura pratica</h2>
          <input className="compact-input" value={month} onChange={(event) => setMonth(event.target.value)} type="month" />
        </div>
        <div className="action-notes">
          {insights.length ? insights.map((item) => <p key={item}>{item}</p>) : <p>Adicione dados para gerar leituras melhores.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Gastos do mes</h2>
          <span>{month}</span>
        </div>
        <PieChart data={currentExpensesByCategory} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Resumo executivo</h2>
        </div>
        <table className="report-table">
          <tbody>
            <tr>
              <th>Entradas</th>
              <td>{maskValue(formatCurrency(summary.income), privacyMode)}</td>
            </tr>
            <tr>
              <th>Saidas</th>
              <td>{maskValue(formatCurrency(summary.expense), privacyMode)}</td>
            </tr>
            <tr>
              <th>Saldo livre</th>
              <td>{maskValue(formatCurrency(summary.balance), privacyMode)}</td>
            </tr>
            <tr>
              <th>Patrimonio estimado</th>
              <td>{maskValue(formatCurrency(summary.netWorth), privacyMode)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SettingsView({
  data,
  privacyMode,
  user,
  onExport,
  onImport,
  onLogout,
  onPrivacyChange,
  onSettingsChange
}: {
  data: FinanceData;
  privacyMode: boolean;
  user: User;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onLogout: () => void;
  onPrivacyChange: (value: boolean) => void;
  onSettingsChange: (settings: FinanceData["settings"]) => void;
}) {
  return (
    <div className="settings-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>Preferencias</h2>
          <Settings size={18} />
        </div>
        <div className="settings-list">
          <label className="toggle-row">
            <span>
              <strong>Tema escuro</strong>
              <small>Ajusta o app para uso continuo com menos brilho.</small>
            </span>
            <input
              checked={data.settings.theme === "dark"}
              onChange={(event) => onSettingsChange({ ...data.settings, theme: event.target.checked ? "dark" : "light" })}
              type="checkbox"
            />
          </label>
          <label className="toggle-row">
            <span>
              <strong>Som de notificacao</strong>
              <small>Usa um tom curto gerado pelo navegador.</small>
            </span>
            <input
              checked={data.settings.soundEnabled}
              onChange={(event) => onSettingsChange({ ...data.settings, soundEnabled: event.target.checked })}
              type="checkbox"
            />
          </label>
          <label className="toggle-row">
            <span>
              <strong>Alertas inteligentes locais</strong>
              <small>Orcamentos, vales e recorrencias geram avisos sem IA.</small>
            </span>
            <input
              checked={data.settings.notificationsEnabled}
              onChange={(event) => onSettingsChange({ ...data.settings, notificationsEnabled: event.target.checked })}
              type="checkbox"
            />
          </label>
          <label className="toggle-row">
            <span>
              <strong>Privacidade visual</strong>
              <small>Oculta valores quando estiver em tela compartilhada.</small>
            </span>
            <input checked={privacyMode} onChange={(event) => onPrivacyChange(event.target.checked)} type="checkbox" />
          </label>
          <label className="toggle-row">
            <span>
              <strong>Modo compacto</strong>
              <small>Reduz espacos para acompanhar mais dados na mesma tela.</small>
            </span>
            <input
              checked={data.settings.compactMode}
              onChange={(event) => onSettingsChange({ ...data.settings, compactMode: event.target.checked })}
              type="checkbox"
            />
          </label>
          <div className="settings-field-grid">
            <label>
              Alerta de orcamento (%)
              <input
                min={1}
                max={100}
                type="number"
                value={data.settings.budgetAlertPercent}
                onChange={(event) => onSettingsChange({ ...data.settings, budgetAlertPercent: Number(event.target.value || 90) })}
              />
            </label>
            <label>
              Alerta de vale (% restante)
              <input
                min={1}
                max={100}
                type="number"
                value={data.settings.voucherAlertPercent}
                onChange={(event) => onSettingsChange({ ...data.settings, voucherAlertPercent: Number(event.target.value || 15) })}
              />
            </label>
            <label>
              Despesa alta (R$)
              <input
                inputMode="decimal"
                value={String(data.settings.bigExpenseAlertAmount)}
                onChange={(event) => onSettingsChange({ ...data.settings, bigExpenseAlertAmount: parseNumber(event.target.value) })}
              />
            </label>
            <label>
              Lembrete de recorrencia (dias)
              <input
                min={0}
                max={30}
                type="number"
                value={data.settings.upcomingReminderDays}
                onChange={(event) => onSettingsChange({ ...data.settings, upcomingReminderDays: Number(event.target.value || 3) })}
              />
            </label>
            <label>
              Filtro padrao
              <select
                value={data.settings.defaultDatePreset}
                onChange={(event) => onSettingsChange({ ...data.settings, defaultDatePreset: event.target.value as DatePreset })}
              >
                {datePresets.filter((item) => item.id !== "custom").map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Dados e conta</h2>
          <span>{user.email || user.username}</span>
        </div>
        <div className="settings-actions">
          <button className="secondary-button" onClick={onExport} type="button">
            <Download size={18} />
            Exportar backup
          </button>
          <label className="upload-button">
            <Upload size={18} />
            Importar backup
            <input accept="application/json,.json" onChange={onImport} type="file" />
          </label>
          <button className="ghost-button" onClick={onLogout} type="button">
            <LogOut size={18} />
            Sair da conta
          </button>
        </div>
        <div className="data-footprint">
          <div>
            <strong>{data.transactions.length}</strong>
            <span>Transacoes</span>
          </div>
          <div>
            <strong>{data.budgets.length}</strong>
            <span>Orcamentos</span>
          </div>
          <div>
            <strong>{data.recurrences.length}</strong>
            <span>Recorrencias</span>
          </div>
          <div>
            <strong>{data.notifications.length}</strong>
            <span>Alertas ativos</span>
          </div>
          <div>
            <strong>{data.notificationHistory.length}</strong>
            <span>Historico</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(() => readStoredUser());

  useEffect(() => {
    const storedTheme = localStorage.getItem(sessionKeys.theme);
    document.documentElement.dataset.theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
  }, []);

  const handleLogin = (nextUser: User, remember: boolean) => {
    storeSessionToken(nextUser, remember);
    storeUser(nextUser, remember);
    setUser(nextUser);
  };

  const handleLogout = () => {
    if (user) {
      localStorage.removeItem(tokenKey(user.username));
      sessionStorage.removeItem(tokenKey(user.username));
    }
    clearStoredUser();
    setUser(null);
  };

  if (!user) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  return <Dashboard user={user} onLogout={handleLogout} />;
}
