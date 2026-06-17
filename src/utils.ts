import type {
  AppSettings,
  DatePreset,
  FinanceData,
  FinancialSummary,
  Recurrence,
  RecurrenceFrequency,
  Transaction
} from "./types";

export const defaultSettings = (): AppSettings => ({
  theme: "dark",
  soundEnabled: true,
  notificationsEnabled: true,
  budgetAlertPercent: 90,
  voucherAlertPercent: 15,
  bigExpenseAlertAmount: 500,
  upcomingReminderDays: 3,
  defaultDatePreset: "currentMonth",
  compactMode: false
});

export const emptyFinanceData = (): FinanceData => ({
  transactions: [],
  investments: [],
  investmentReturns: [],
  vouchers: [],
  goals: [],
  budgets: [],
  recurrences: [],
  notifications: [],
  notificationHistory: [],
  settings: defaultSettings()
});

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const currentMonthKey = () => todayIso().slice(0, 7);

export const startOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);

export const endOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth() + 1, 0);

export const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

export const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const formatCurrency = (value: number) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

export const formatDate = (value?: string) => {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};

export const parseNumber = (value: string | number) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const clean = value
    .trim()
    .replace(/[^\d,.-]/g, "")
    .replace(/\s/g, "");
  if (!clean) return 0;

  const hasComma = clean.includes(",");
  const hasDot = clean.includes(".");
  let normalized = clean;

  if (hasComma && hasDot) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = clean.replace(",", ".");
  } else if (hasDot) {
    const parts = clean.split(".");
    const last = parts[parts.length - 1] || "";
    normalized = parts.length === 2 && last.length <= 2 ? clean : clean.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export const toMonthKey = (date?: string) => (date || todayIso()).slice(0, 7);

export const resolveDateRange = (
  preset: DatePreset,
  customStart?: string,
  customEnd?: string
): { start: string; end: string; label: string } => {
  const now = new Date();
  const today = toIsoDate(now);
  const daysAgo = (days: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    return toIsoDate(date);
  };

  if (preset === "all") return { start: "", end: "", label: "Todo periodo" };
  if (preset === "today") return { start: today, end: today, label: "Hoje" };
  if (preset === "7d") return { start: daysAgo(6), end: today, label: "Ultimos 7 dias" };
  if (preset === "30d") return { start: daysAgo(29), end: today, label: "Ultimos 30 dias" };
  if (preset === "currentMonth") return { start: toIsoDate(startOfMonth(now)), end: toIsoDate(endOfMonth(now)), label: "Mes atual" };
  if (preset === "lastMonth") {
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start: toIsoDate(startOfMonth(last)), end: toIsoDate(endOfMonth(last)), label: "Mes passado" };
  }
  if (preset === "currentYear") {
    return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31`, label: "Ano atual" };
  }
  return {
    start: customStart || "",
    end: customEnd || "",
    label: customStart || customEnd ? "Periodo personalizado" : "Personalizado"
  };
};

export const daysBetween = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.ceil((end - start) / 86400000);
};

export const calculateNextDate = (date: string, frequency: RecurrenceFrequency) => {
  const source = date || todayIso();
  const base = new Date(`${source}T00:00:00`);
  const day = base.getDate();
  if (frequency === "weekly") base.setDate(base.getDate() + 7);
  if (frequency === "monthly") {
    const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
    return toIsoDate(next);
  }
  if (frequency === "yearly") base.setFullYear(base.getFullYear() + 1);
  return base.toISOString().slice(0, 10);
};

export const processDueAutomations = (data: FinanceData, until = todayIso()): FinanceData => {
  let next = normalizeFinanceData(data);
  const generated: Transaction[] = [];
  const recurrences = next.recurrences.map((recurrence) => {
    if (!recurrence.active || !recurrence.autoPost) return recurrence;
    let nextDate = recurrence.nextDate || until;
    let guard = 0;
    while (nextDate <= until && guard < 36) {
      const alreadyExists = next.transactions.some(
        (item) => item.recurrenceId === recurrence.id && item.date === nextDate
      );
      if (!alreadyExists) generated.push({ ...buildTransactionFromRecurrence({ ...recurrence, nextDate }), date: nextDate });
      nextDate = calculateNextDate(nextDate, recurrence.frequency);
      guard += 1;
    }
    return { ...recurrence, nextDate };
  });

  const vouchers = next.vouchers.map((voucher) => {
    if (!voucher.autoRenew) return voucher;
    const renewDate = `${until.slice(0, 7)}-${String(Math.max(1, Math.min(28, voucher.renewDay || 1))).padStart(2, "0")}`;
    if (renewDate <= until && voucher.lastRenewedDate !== renewDate) {
      return { ...voucher, used: 0, lastRenewedDate: renewDate };
    }
    return voucher;
  });

  return { ...next, transactions: [...generated, ...next.transactions], recurrences, vouchers };
};

export const calculateSummary = (data: FinanceData, month = currentMonthKey()): FinancialSummary => {
  const monthTransactions = data.transactions.filter((item) => toMonthKey(item.date) === month);

  const income = monthTransactions
    .filter((item) => item.type === "income")
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  const expense = monthTransactions
    .filter((item) => item.type === "expense")
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  const invested = data.investments.reduce((total, item) => total + Number(item.amount || 0), 0);
  const deductibleInvestments = data.investments
    .filter((item) => item.isDeductible)
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  const voucherTotal = data.vouchers.reduce((total, item) => total + Number(item.total || 0), 0);
  const voucherUsed = data.vouchers.reduce((total, item) => total + Number(item.used || 0), 0);

  const goalsCurrent = data.goals.reduce((total, item) => total + Number(item.current || 0), 0);
  const goalsTarget = data.goals.reduce((total, item) => total + Number(item.target || 0), 0);

  const monthBudgets = data.budgets.filter((budget) => budget.month === month);
  const budgeted = monthBudgets.reduce((total, budget) => total + Number(budget.amount || 0), 0);
  const budgetedCategories = new Set(monthBudgets.map((budget) => budget.category));

  const expensesThisMonth = monthTransactions.filter((item) => item.type === "expense");
  const budgetSpent = expensesThisMonth
    .filter((item) => budgetedCategories.has(item.category))
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  const recurringIncome = data.recurrences
    .filter((item) => item.active && item.type === "income")
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  const recurringExpense = data.recurrences
    .filter((item) => item.active && item.type === "expense")
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  const today = todayIso();
  const upcomingExpenses = data.recurrences
    .filter((item) => item.active && item.type === "expense")
    .filter((item) => daysBetween(today, item.nextDate) >= 0 && daysBetween(today, item.nextDate) <= 30)
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  const balance = income - expense - deductibleInvestments;
  const investmentReturnMonth = data.investmentReturns
    .filter((item) => item.month === month)
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  return {
    income,
    expense,
    invested,
    deductibleInvestments,
    balance,
    netWorth: balance + invested + goalsCurrent + Math.max(0, voucherTotal - voucherUsed),
    voucherTotal,
    voucherUsed,
    voucherAvailable: voucherTotal - voucherUsed,
    goalsCurrent,
    goalsTarget,
    budgeted,
    budgetSpent,
    budgetRemaining: budgeted - budgetSpent,
    recurringIncome,
    recurringExpense,
    upcomingExpenses,
    savingsRate: income > 0 ? Math.round((balance / income) * 100) : 0,
    investmentReturnMonth,
    investmentReturnPercent: invested > 0 ? Number(((investmentReturnMonth / invested) * 100).toFixed(2)) : 0
  };
};

export const groupByAmount = <T extends object>(
  items: T[],
  key: keyof T,
  amountKey: keyof T
) => {
  const grouped = new Map<string, number>();
  items.forEach((item) => {
    const label = String(item[key] || "Geral");
    const amount = Number(item[amountKey] || 0);
    grouped.set(label, (grouped.get(label) || 0) + amount);
  });
  return Array.from(grouped.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
};

export const buildTransactionFromRecurrence = (recurrence: Recurrence): Transaction => ({
  id: makeId(),
  description: recurrence.description,
  amount: recurrence.amount,
  type: recurrence.type,
  category: recurrence.category,
  date: recurrence.nextDate || todayIso(),
  createdAt: todayIso(),
  recurrenceId: recurrence.id
});

export const normalizeFinanceData = (data?: Partial<FinanceData>): FinanceData => {
  const empty = emptyFinanceData();
  const settings = {
    ...empty.settings,
    ...(data?.settings || {})
  };
  const validPresets: DatePreset[] = ["all", "today", "7d", "30d", "currentMonth", "lastMonth", "currentYear", "custom"];
  settings.defaultDatePreset = validPresets.includes(settings.defaultDatePreset) ? settings.defaultDatePreset : "currentMonth";
  settings.budgetAlertPercent = clamp(Number(settings.budgetAlertPercent || 90), 1, 100);
  settings.voucherAlertPercent = clamp(Number(settings.voucherAlertPercent || 15), 1, 100);
  settings.bigExpenseAlertAmount = Math.max(0, Number(settings.bigExpenseAlertAmount || 0));
  settings.upcomingReminderDays = Math.max(0, Number(settings.upcomingReminderDays || 3));

  return {
    transactions: Array.isArray(data?.transactions) ? data.transactions : empty.transactions,
    investments: Array.isArray(data?.investments) ? data.investments : empty.investments,
    investmentReturns: Array.isArray(data?.investmentReturns) ? data.investmentReturns : empty.investmentReturns,
    vouchers: Array.isArray(data?.vouchers)
      ? data.vouchers.map((item) => ({
          ...item,
          history: Array.isArray(item.history) ? item.history : [],
          autoRenew: Boolean(item.autoRenew),
          renewDay: Number(item.renewDay || 1)
        }))
      : empty.vouchers,
    goals: Array.isArray(data?.goals) ? data.goals : empty.goals,
    budgets: Array.isArray(data?.budgets) ? data.budgets : empty.budgets,
    recurrences: Array.isArray(data?.recurrences) ? data.recurrences : empty.recurrences,
    notifications: Array.isArray(data?.notifications) ? data.notifications : empty.notifications,
    notificationHistory: Array.isArray(data?.notificationHistory) ? data.notificationHistory : empty.notificationHistory,
    settings
  };
};
