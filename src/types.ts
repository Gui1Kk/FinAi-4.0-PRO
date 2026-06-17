export type TransactionType = "income" | "expense";

export type SyncStatus = "idle" | "loading" | "saving" | "online" | "local" | "error";

export type ThemeMode = "light" | "dark";

export type NotificationType = "success" | "warning" | "error" | "info";

export type RecurrenceFrequency = "weekly" | "monthly" | "yearly";

export type DatePreset = "all" | "today" | "7d" | "30d" | "currentMonth" | "lastMonth" | "currentYear" | "custom";

export interface User {
  username: string;
  email?: string;
  userId?: string;
  token?: string;
}

export interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  date: string;
  createdAt: string;
  note?: string;
  recurrenceId?: string;
}

export interface Investment {
  id: string;
  name: string;
  amount: number;
  type: string;
  isDeductible: boolean;
  createdAt: string;
}

export interface InvestmentReturn {
  id: string;
  investmentId: string;
  investmentName: string;
  month: string;
  amount: number;
  percent: number;
  note?: string;
  createdAt: string;
}

export interface VoucherUse {
  id: string;
  amount: number;
  date: string;
  note?: string;
}

export interface Voucher {
  id: string;
  name: string;
  total: number;
  used: number;
  createdAt: string;
  history: VoucherUse[];
  autoRenew: boolean;
  renewDay: number;
  lastRenewedDate?: string;
}

export interface Goal {
  id: string;
  name: string;
  current: number;
  target: number;
  targetDate?: string;
  createdAt: string;
}

export interface Budget {
  id: string;
  category: string;
  amount: number;
  month: string;
  rollover: boolean;
  createdAt: string;
}

export interface Recurrence {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  frequency: RecurrenceFrequency;
  nextDate: string;
  active: boolean;
  autoPost: boolean;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  createdAt: string;
  read: boolean;
  key?: string;
}

export interface AppSettings {
  theme: ThemeMode;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  budgetAlertPercent: number;
  voucherAlertPercent: number;
  bigExpenseAlertAmount: number;
  upcomingReminderDays: number;
  defaultDatePreset: DatePreset;
  compactMode: boolean;
}

export interface FinanceData {
  transactions: Transaction[];
  investments: Investment[];
  investmentReturns: InvestmentReturn[];
  vouchers: Voucher[];
  goals: Goal[];
  budgets: Budget[];
  recurrences: Recurrence[];
  notifications: NotificationItem[];
  notificationHistory: NotificationItem[];
  settings: AppSettings;
}

export interface FinancialSummary {
  income: number;
  expense: number;
  invested: number;
  deductibleInvestments: number;
  balance: number;
  netWorth: number;
  voucherTotal: number;
  voucherUsed: number;
  voucherAvailable: number;
  goalsCurrent: number;
  goalsTarget: number;
  budgeted: number;
  budgetSpent: number;
  budgetRemaining: number;
  recurringIncome: number;
  recurringExpense: number;
  upcomingExpenses: number;
  savingsRate: number;
  investmentReturnMonth: number;
  investmentReturnPercent: number;
}

export interface ApiResult<T = unknown> {
  status: "success" | "error";
  data?: T;
  user?: User;
  message?: string;
  source?: "remote" | "local";
}
