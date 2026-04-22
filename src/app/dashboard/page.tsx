'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthUser {
  id: string;
  telegram_id: number;
  role: string;
  first_name: string | null;
  username: string | null;
}

interface DashUser {
  id: string;
  telegram_id: number;
  role: 'admin' | 'employee';
  first_name: string | null;
  username: string | null;
  created_at: string;
}

interface DashProject {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

interface Summary {
  totalEmployees: number;
  totalAdmins: number;
  activeProjects: number;
  inProgressTasks: number;
  completedThisWeek: number;
}

interface EmpStat {
  id: string;
  name: string;
  username: string | null;
  weeklyMinutes: number;
  activeTasks: number;
}

interface ProjStat {
  id: string;
  name: string;
  taskCount: number;
  activeCount: number;
}

interface TaskStat {
  id: string;
  name: string;
  status: 'in_progress' | 'paused' | 'completed';
  projectName: string;
  userName: string;
  createdAt: string;
  weeklyMinutes: number;
}

interface StatsData {
  summary: Summary;
  employees: EmpStat[];
  projects: ProjStat[];
  recentTasks: TaskStat[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET = 'workbotsecret2026';
const HEADERS = { 'Content-Type': 'application/json', 'x-dashboard-secret': SECRET };

type Tab = 'overview' | 'team' | 'projects' | 'tasks' | 'admins';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(minutes: number): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}хв`;
  if (m === 0) return `${h}г`;
  return `${h}г ${m}хв`;
}

function displayName(u: DashUser | EmpStat): string {
  if ('first_name' in u) {
    // u is DashUser
    return u.first_name ?? (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
  }
  // u is EmpStat
  return u.name;
}

function statusBadge(status: TaskStat['status']): JSX.Element {
  const map: Record<TaskStat['status'], { label: string; cls: string }> = {
    in_progress: { label: 'В роботі', cls: 'bg-blue-100 text-blue-700' },
    paused: { label: 'Пауза', cls: 'bg-yellow-100 text-yellow-700' },
    completed: { label: 'Завершено', cls: 'bg-green-100 text-green-700' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Add/Edit User Modal ──────────────────────────────────────────────────────

interface UserModalProps {
  defaultRole?: 'admin' | 'employee';
  editUser?: DashUser | null;
  onClose: () => void;
  onSave: (data: { telegramId?: number; firstName: string; username: string; role: 'admin' | 'employee' }) => Promise<void>;
}

function UserModal({ defaultRole = 'employee', editUser, onClose, onSave }: UserModalProps) {
  const [telegramId, setTelegramId] = useState('');
  const [firstName, setFirstName] = useState(editUser?.first_name ?? '');
  const [username, setUsername] = useState(editUser?.username ?? '');
  const [role, setRole] = useState<'admin' | 'employee'>(editUser?.role ?? defaultRole);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const isEdit = !!editUser;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!isEdit && !telegramId) { setErr('Введіть Telegram ID'); return; }
    setSaving(true);
    try {
      await onSave({
        telegramId: isEdit ? undefined : Number(telegramId),
        firstName,
        username,
        role,
      });
      onClose();
    } catch (e: any) {
      setErr(e.message ?? 'Помилка');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Редагувати користувача' : 'Додати користувача'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!isEdit && (
          <div>
            <label className="block text-sm text-gray-600 mb-1">Telegram ID *</label>
            <input
              type="number"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="123456789"
            />
          </div>
        )}
        <div>
          <label className="block text-sm text-gray-600 mb-1">Ім'я</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Іван"
          />
        </div>
        {!isEdit && (
          <>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="ivan_ua"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Роль</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'employee')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="employee">Співробітник</option>
                <option value="admin">Адмін</option>
              </select>
            </div>
          </>
        )}
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Збереження...' : 'Зберегти'}
        </button>
      </form>
    </Modal>
  );
}

// ─── Create Project Modal ─────────────────────────────────────────────────────

function ProjectModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Введіть назву'); return; }
    setSaving(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (e: any) {
      setErr(e.message ?? 'Помилка');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Новий проєкт" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Назва проєкту *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Назва проєкту"
            autoFocus
          />
        </div>
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Створення...' : 'Створити'}
        </button>
      </form>
    </Modal>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: StatsData }) {
  const { summary, employees, recentTasks } = stats;

  const statCards = [
    { label: 'Співробітники', value: summary.totalEmployees, icon: '👥', color: 'bg-blue-50 text-blue-600' },
    { label: 'Активні проєкти', value: summary.activeProjects, icon: '📁', color: 'bg-green-50 text-green-600' },
    { label: 'В роботі зараз', value: summary.inProgressTasks, icon: '⚡', color: 'bg-yellow-50 text-yellow-600' },
    { label: 'Завершено цього тижня', value: summary.completedThisWeek, icon: '✅', color: 'bg-purple-50 text-purple-600' },
  ];

  const top5 = [...employees].sort((a, b) => b.weeklyMinutes - a.weeklyMinutes).slice(0, 5);
  const activeTasks = recentTasks.filter((t) => t.status === 'in_progress');

  return (
    <div className="space-y-6">
      {/* Stat cards 2x2 */}
      <div className="grid grid-cols-2 gap-3">
        {statCards.map((c) => (
          <div key={c.label} className={`rounded-2xl p-4 ${c.color.split(' ')[0]}`}>
            <div className="text-2xl mb-1">{c.icon}</div>
            <div className={`text-2xl font-bold ${c.color.split(' ')[1]}`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Top employees */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Топ-5 за тиждень</h2>
        {top5.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Немає даних</p>
        ) : (
          <div className="space-y-2">
            {top5.map((emp, i) => (
              <div key={emp.id} className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-sm">
                <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0">
                  {emp.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{emp.name}</p>
                  {emp.username && <p className="text-xs text-gray-400">@{emp.username}</p>}
                </div>
                <span className="text-sm font-semibold text-blue-600">{fmtTime(emp.weeklyMinutes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active tasks */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Активні задачі</h2>
        {activeTasks.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Немає активних задач</p>
        ) : (
          <div className="space-y-2">
            {activeTasks.slice(0, 10).map((t) => (
              <div key={t.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">{t.name}</p>
                  {statusBadge(t.status)}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  <span>{t.userName}</span>
                  <span>·</span>
                  <span>{t.projectName}</span>
                  {t.weeklyMinutes > 0 && (
                    <>
                      <span>·</span>
                      <span>{fmtTime(t.weeklyMinutes)}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────

interface TeamTabProps {
  users: DashUser[];
  stats: StatsData | null;
  authUser: AuthUser;
  onAdd: (data: { telegramId?: number; firstName: string; username: string; role: 'admin' | 'employee' }) => Promise<void>;
  onEdit: (id: string, firstName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function TeamTab({ users, stats, authUser, onAdd, onEdit, onDelete }: TeamTabProps) {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<DashUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const employees = users.filter((u) => u.role === 'employee');
  const filtered = employees.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.first_name ?? '').toLowerCase().includes(q) ||
      (u.username ?? '').toLowerCase().includes(q) ||
      String(u.telegram_id).includes(q)
    );
  });

  function getEmpStat(id: string): EmpStat | undefined {
    return stats?.employees.find((e) => e.id === id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук..."
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          onClick={() => setShowAdd(true)}
          className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
        >
          ➕ Додати
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Співробітників не знайдено</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const empStat = getEmpStat(u.id);
            const isConfirming = confirmDelete === u.id;
            return (
              <div key={u.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0">
                    {(u.first_name ?? u.username ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{displayName(u)}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {u.username && <span>@{u.username}</span>}
                      {empStat && empStat.weeklyMinutes > 0 && (
                        <span className="text-blue-500 font-medium">{fmtTime(empStat.weeklyMinutes)}</span>
                      )}
                    </div>
                  </div>
                  {!isConfirming && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditUser(u)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition-colors"
                        title="Редагувати"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => setConfirmDelete(u.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                        title="Видалити"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
                {isConfirming && (
                  <div className="mt-2 flex items-center gap-2 justify-end">
                    <span className="text-sm text-red-600">Видалити?</span>
                    <button
                      onClick={async () => { await onDelete(u.id); setConfirmDelete(null); }}
                      className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition-colors"
                    >
                      Так
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded-lg transition-colors"
                    >
                      Скасувати
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <UserModal
          defaultRole="employee"
          onClose={() => setShowAdd(false)}
          onSave={onAdd}
        />
      )}
      {editUser && (
        <UserModal
          editUser={editUser}
          onClose={() => setEditUser(null)}
          onSave={async (data) => { await onEdit(editUser.id, data.firstName); }}
        />
      )}
    </div>
  );
}

// ─── Projects Tab ─────────────────────────────────────────────────────────────

interface ProjectsTabProps {
  projects: DashProject[];
  stats: StatsData | null;
  onCreate: (name: string) => Promise<void>;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function ProjectsTab({ projects, stats, onCreate, onToggle, onDelete }: ProjectsTabProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function getProjStat(id: string): ProjStat | undefined {
    return stats?.projects.find((p) => p.id === id);
  }

  const sorted = [...projects].sort((a, b) => {
    if (a.is_active === b.is_active) return a.name.localeCompare(b.name);
    return a.is_active ? -1 : 1;
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
        >
          ➕ Створити
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Проєктів немає</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => {
            const pStat = getProjStat(p.id);
            const isConfirming = confirmDelete === p.id;
            return (
              <div key={p.id} className={`bg-white rounded-xl px-4 py-3 shadow-sm ${!p.is_active ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                      {!p.is_active && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Неактивний</span>
                      )}
                      {pStat && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                          {pStat.taskCount} задач
                        </span>
                      )}
                    </div>
                    {pStat && pStat.activeCount > 0 && (
                      <p className="text-xs text-green-600 mt-0.5">{pStat.activeCount} активних</p>
                    )}
                  </div>
                  {!isConfirming && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onToggle(p.id, !p.is_active)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-base"
                        title={p.is_active ? 'Деактивувати' : 'Активувати'}
                      >
                        {p.is_active ? '🟢' : '🔴'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(p.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                        title="Видалити"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
                {isConfirming && (
                  <div className="mt-2 flex items-center gap-2 justify-end">
                    <span className="text-sm text-red-600">Видалити?</span>
                    <button
                      onClick={async () => { await onDelete(p.id); setConfirmDelete(null); }}
                      className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition-colors"
                    >
                      Так
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded-lg transition-colors"
                    >
                      Скасувати
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <ProjectModal onClose={() => setShowCreate(false)} onSave={onCreate} />
      )}
    </div>
  );
}

// ─── Tasks Tab ────────────────────────────────────────────────────────────────

function TasksTab({ tasks }: { tasks: TaskStat[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStat['status']>('all');

  const filtered = tasks.filter((t) => {
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch =
      t.name.toLowerCase().includes(q) ||
      t.userName.toLowerCase().includes(q) ||
      t.projectName.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const chips: { key: 'all' | TaskStat['status']; label: string }[] = [
    { key: 'all', label: 'Всі' },
    { key: 'in_progress', label: 'В роботі' },
    { key: 'paused', label: 'Пауза' },
    { key: 'completed', label: 'Завершено' },
  ];

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Пошук задач..."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <div className="flex gap-2 flex-wrap">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setStatusFilter(c.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              statusFilter === c.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Задач не знайдено</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <div key={t.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">{t.name}</p>
                {statusBadge(t.status)}
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
                <span>{t.userName}</span>
                <span>·</span>
                <span>{t.projectName}</span>
                {t.weeklyMinutes > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-blue-500">{fmtTime(t.weeklyMinutes)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Admins Tab ───────────────────────────────────────────────────────────────

interface AdminsTabProps {
  users: DashUser[];
  authUser: AuthUser;
  onAdd: (data: { telegramId?: number; firstName: string; username: string; role: 'admin' | 'employee' }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function AdminsTab({ users, authUser, onAdd, onDelete }: AdminsTabProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const admins = users.filter((u) => u.role === 'admin');

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
        >
          ➕ Додати адміна
        </button>
      </div>

      {admins.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Адмінів немає</p>
      ) : (
        <div className="space-y-2">
          {admins.map((u) => {
            const isSelf = u.telegram_id === authUser.telegram_id;
            const isConfirming = confirmDelete === u.id;
            return (
              <div key={u.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-semibold text-sm flex-shrink-0">
                    {(u.first_name ?? u.username ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-800 truncate">{displayName(u)}</p>
                      {isSelf && (
                        <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">Ви</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {u.username && <span>@{u.username}</span>}
                      <span>ID: {u.telegram_id}</span>
                    </div>
                  </div>
                  {!isConfirming && !isSelf && (
                    <button
                      onClick={() => setConfirmDelete(u.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                      title="Видалити"
                    >
                      🗑
                    </button>
                  )}
                </div>
                {isConfirming && (
                  <div className="mt-2 flex items-center gap-2 justify-end">
                    <span className="text-sm text-red-600">Видалити?</span>
                    <button
                      onClick={async () => { await onDelete(u.id); setConfirmDelete(null); }}
                      className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition-colors"
                    >
                      Так
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded-lg transition-colors"
                    >
                      Скасувати
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <UserModal
          defaultRole="admin"
          onClose={() => setShowAdd(false)}
          onSave={onAdd}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [authState, setAuthState] = useState<'loading' | 'denied' | 'ok'>('loading');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

  const [users, setUsers] = useState<DashUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');

  const [projects, setProjects] = useState<DashProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tid = params.get('tid');
    if (!tid) {
      setAuthState('denied');
      setAuthError('no_tid');
      return;
    }

    fetch('/api/dashboard/auth', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ telegramId: Number(tid) }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.ok || data.user?.role !== 'admin') {
          setAuthState('denied');
          setAuthError(data.error ?? 'not_admin');
        } else {
          setAuthUser(data.user);
          setAuthState('ok');
        }
      })
      .catch(() => {
        setAuthState('denied');
        setAuthError('network');
      });
  }, []);

  // ── Data fetchers ─────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      const res = await fetch('/api/dashboard/stats', { headers: HEADERS });
      if (!res.ok) throw new Error('Помилка завантаження статистики');
      const data = await res.json();
      setStats(data);
    } catch (e: any) {
      setStatsError(e.message ?? 'Помилка');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const res = await fetch('/api/dashboard/users', { headers: HEADERS });
      if (!res.ok) throw new Error('Помилка завантаження користувачів');
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch (e: any) {
      setUsersError(e.message ?? 'Помилка');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError('');
    try {
      const res = await fetch('/api/dashboard/projects', { headers: HEADERS });
      if (!res.ok) throw new Error('Помилка завантаження проєктів');
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch (e: any) {
      setProjectsError(e.message ?? 'Помилка');
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // ── Initial load after auth ───────────────────────────────────────────────

  useEffect(() => {
    if (authState !== 'ok') return;
    fetchStats();
    fetchUsers();
    fetchProjects();
  }, [authState, fetchStats, fetchUsers, fetchProjects]);

  // ── Refresh all ───────────────────────────────────────────────────────────

  function refreshAll() {
    fetchStats();
    fetchUsers();
    fetchProjects();
  }

  // ── User mutations ────────────────────────────────────────────────────────

  async function handleAddUser(data: { telegramId?: number; firstName: string; username: string; role: 'admin' | 'employee' }) {
    const res = await fetch('/api/dashboard/users', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        telegramId: data.telegramId,
        firstName: data.firstName || undefined,
        username: data.username || undefined,
        role: data.role,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Помилка');
    // Optimistic: prepend new user
    setUsers((prev) => [json.user, ...prev]);
    fetchStats();
  }

  async function handleEditUser(id: string, firstName: string) {
    const res = await fetch('/api/dashboard/users', {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ id, firstName: firstName || null }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Помилка');
    setUsers((prev) => prev.map((u) => (u.id === id ? json.user : u)));
  }

  async function handleDeleteUser(id: string) {
    // Optimistic remove
    setUsers((prev) => prev.filter((u) => u.id !== id));
    const res = await fetch('/api/dashboard/users', {
      method: 'DELETE',
      headers: HEADERS,
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      // Rollback on failure
      fetchUsers();
    } else {
      fetchStats();
    }
  }

  // ── Project mutations ─────────────────────────────────────────────────────

  async function handleCreateProject(name: string) {
    const res = await fetch('/api/dashboard/projects', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Помилка');
    setProjects((prev) => [json.project, ...prev]);
    fetchStats();
  }

  async function handleToggleProject(id: string, isActive: boolean) {
    // Optimistic update
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: isActive } : p)));
    const res = await fetch('/api/dashboard/projects', {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ id, is_active: isActive }),
    });
    if (!res.ok) {
      fetchProjects();
    } else {
      fetchStats();
    }
  }

  async function handleDeleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    const res = await fetch('/api/dashboard/projects', {
      method: 'DELETE',
      headers: HEADERS,
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      fetchProjects();
    } else {
      fetchStats();
    }
  }

  // ── Render: auth states ───────────────────────────────────────────────────

  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">Перевірка доступу...</p>
        </div>
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Доступ заборонено</h1>
          {authError === 'no_tid' ? (
            <p className="text-sm text-gray-500">
              Відкрийте цю сторінку через бота. Посилання повинно містити ваш Telegram ID.
            </p>
          ) : authError === 'network' ? (
            <p className="text-sm text-gray-500">Помилка мережі. Перевірте з'єднання та спробуйте ще раз.</p>
          ) : (
            <p className="text-sm text-gray-500">
              У вас немає прав адміністратора. Зверніться до власника бота.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Render: dashboard ─────────────────────────────────────────────────────

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'overview', icon: '📊', label: 'Огляд' },
    { key: 'team', icon: '👥', label: 'Команда' },
    { key: 'projects', icon: '📁', label: 'Проєкти' },
    { key: 'tasks', icon: '📋', label: 'Задачі' },
    { key: 'admins', icon: '🔑', label: 'Адміни' },
  ];

  const isLoading = statsLoading || usersLoading || projectsLoading;

  function renderTabContent() {
    if (activeTab === 'overview') {
      if (statsLoading && !stats) return <Spinner />;
      if (statsError) return (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-3">{statsError}</p>
          <button onClick={fetchStats} className="text-sm text-blue-600 underline">Спробувати ще раз</button>
        </div>
      );
      if (!stats) return <Spinner />;
      return <OverviewTab stats={stats} />;
    }

    if (activeTab === 'team') {
      if (usersLoading && users.length === 0) return <Spinner />;
      if (usersError) return (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-3">{usersError}</p>
          <button onClick={fetchUsers} className="text-sm text-blue-600 underline">Спробувати ще раз</button>
        </div>
      );
      return (
        <TeamTab
          users={users}
          stats={stats}
          authUser={authUser!}
          onAdd={handleAddUser}
          onEdit={handleEditUser}
          onDelete={handleDeleteUser}
        />
      );
    }

    if (activeTab === 'projects') {
      if (projectsLoading && projects.length === 0) return <Spinner />;
      if (projectsError) return (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-3">{projectsError}</p>
          <button onClick={fetchProjects} className="text-sm text-blue-600 underline">Спробувати ще раз</button>
        </div>
      );
      return (
        <ProjectsTab
          projects={projects}
          stats={stats}
          onCreate={handleCreateProject}
          onToggle={handleToggleProject}
          onDelete={handleDeleteProject}
        />
      );
    }

    if (activeTab === 'tasks') {
      if (statsLoading && !stats) return <Spinner />;
      if (statsError) return (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-3">{statsError}</p>
          <button onClick={fetchStats} className="text-sm text-blue-600 underline">Спробувати ще раз</button>
        </div>
      );
      return <TasksTab tasks={stats?.recentTasks ?? []} />;
    }

    if (activeTab === 'admins') {
      if (usersLoading && users.length === 0) return <Spinner />;
      if (usersError) return (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-3">{usersError}</p>
          <button onClick={fetchUsers} className="text-sm text-blue-600 underline">Спробувати ще раз</button>
        </div>
      );
      return (
        <AdminsTab
          users={users}
          authUser={authUser!}
          onAdd={handleAddUser}
          onDelete={handleDeleteUser}
        />
      );
    }

    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <span className="font-bold text-gray-900 text-base">U:DO Work</span>
            <span className="text-xs text-gray-400 ml-2">Адмін панель</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 hidden sm:block">
              {authUser?.first_name ?? (authUser?.username ? `@${authUser.username}` : '')}
            </span>
            <button
              onClick={refreshAll}
              disabled={isLoading}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
              title="Оновити"
            >
              <span className={`text-base ${isLoading ? 'animate-spin inline-block' : ''}`}>🔄</span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 pb-24">
        {renderTabContent()}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40">
        <div className="max-w-2xl mx-auto flex">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                activeTab === t.key ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <span className="text-lg leading-none">{t.icon}</span>
              <span className="text-[10px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
