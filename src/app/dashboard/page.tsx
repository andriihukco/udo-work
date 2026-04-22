'use client';

import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Summary {
  totalEmployees: number;
  totalAdmins: number;
  activeProjects: number;
  inProgressTasks: number;
  completedThisWeek: number;
}

interface Employee {
  id: string;
  name: string;
  username: string | null;
  weeklyMinutes: number;
  activeTasks: number;
}

interface Project {
  id: string;
  name: string;
  taskCount: number;
  activeCount: number;
}

interface Task {
  id: string;
  name: string;
  status: 'in_progress' | 'paused' | 'completed';
  projectName: string;
  userName: string;
  createdAt: string;
  weeklyMinutes: number;
}

interface DashboardData {
  summary: Summary;
  employees: Employee[];
  projects: Project[];
  recentTasks: Task[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(minutes: number): string {
  if (minutes === 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}хв`;
  if (m === 0) return `${h}г`;
  return `${h}г ${m}хв`;
}

function statusBadge(status: Task['status']) {
  if (status === 'in_progress') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
      В роботі
    </span>
  );
  if (status === 'paused') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
      ⏸ Пауза
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
      ✅ Завершено
    </span>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${color}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800 leading-none">{value}</div>
        <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

type Tab = 'overview' | 'employees' | 'projects' | 'tasks';

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Task['status']>('all');

  useEffect(() => {
    fetch('/api/dashboard/stats', {
      headers: { 'x-dashboard-secret': 'workbotsecret2026' },
    })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError('Не вдалося завантажити дані'); setLoading(false); });
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-sm">Завантаження...</p>
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="text-4xl mb-2">⚠️</div>
        <p className="text-slate-600">{error ?? 'Помилка'}</p>
      </div>
    </div>
  );

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Огляд', icon: '📊' },
    { id: 'employees', label: 'Команда', icon: '👥' },
    { id: 'projects', label: 'Проєкти', icon: '📁' },
    { id: 'tasks', label: 'Задачі', icon: '📋' },
  ];

  const filteredTasks = data.recentTasks
    .filter((t) => statusFilter === 'all' || t.status === statusFilter)
    .filter((t) =>
      search === '' ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.userName.toLowerCase().includes(search.toLowerCase()) ||
      t.projectName.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">U</div>
            <div>
              <div className="font-semibold text-slate-800 text-sm leading-none">U:DO Work</div>
              <div className="text-xs text-slate-400">Адмін панель</div>
            </div>
          </div>
          <button
            onClick={() => { setLoading(true); setError(null);
              fetch('/api/dashboard/stats', { headers: { 'x-dashboard-secret': 'workbotsecret2026' } })
                .then(r => r.json()).then(d => { setData(d); setLoading(false); })
                .catch(() => { setError('Помилка'); setLoading(false); });
            }}
            className="text-blue-600 text-sm font-medium"
          >
            ↻ Оновити
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4">

        {/* Overview tab */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon="👥" label="Співробітники" value={data.summary.totalEmployees} color="bg-blue-50" />
              <StatCard icon="📁" label="Активні проєкти" value={data.summary.activeProjects} color="bg-purple-50" />
              <StatCard icon="▶️" label="В роботі зараз" value={data.summary.inProgressTasks} color="bg-green-50" />
              <StatCard icon="✅" label="Завершено (тиждень)" value={data.summary.completedThisWeek} color="bg-slate-50" />
            </div>

            {/* Top employees this week */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-50">
                <h2 className="font-semibold text-slate-700 text-sm">🏆 Топ команди за тиждень</h2>
              </div>
              {data.employees.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">Немає даних</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {[...data.employees]
                    .sort((a, b) => b.weeklyMinutes - a.weeklyMinutes)
                    .slice(0, 5)
                    .map((emp, i) => (
                      <div key={emp.id} className="px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-slate-400 text-sm w-4">{i + 1}</span>
                          <div>
                            <div className="text-sm font-medium text-slate-700">{emp.name}</div>
                            {emp.username && <div className="text-xs text-slate-400">@{emp.username}</div>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-slate-700">{fmtTime(emp.weeklyMinutes)}</div>
                          {emp.activeTasks > 0 && (
                            <div className="text-xs text-green-600">▶ активна</div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Active tasks */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-50">
                <h2 className="font-semibold text-slate-700 text-sm">▶️ Зараз в роботі</h2>
              </div>
              {data.recentTasks.filter(t => t.status === 'in_progress').length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">Нічого активного</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {data.recentTasks.filter(t => t.status === 'in_progress').slice(0, 8).map(t => (
                    <div key={t.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-700 truncate">{t.name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{t.userName} · {t.projectName}</div>
                        </div>
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse mt-1.5 shrink-0" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Employees tab */}
        {tab === 'employees' && (
          <div className="space-y-3">
            <input
              type="text"
              placeholder="🔍 Пошук..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"
            />
            {data.employees
              .filter(e => search === '' || e.name.toLowerCase().includes(search.toLowerCase()) || (e.username ?? '').toLowerCase().includes(search.toLowerCase()))
              .sort((a, b) => b.weeklyMinutes - a.weeklyMinutes)
              .map(emp => (
                <div key={emp.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                        {emp.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-700">{emp.name}</div>
                        {emp.username && <div className="text-xs text-slate-400">@{emp.username}</div>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-700">{fmtTime(emp.weeklyMinutes)}</div>
                      <div className="text-xs text-slate-400">цей тиждень</div>
                    </div>
                  </div>
                  {emp.activeTasks > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Зараз в роботі
                    </div>
                  )}
                </div>
              ))}
            {data.employees.length === 0 && (
              <p className="text-center text-slate-400 py-10">Немає співробітників</p>
            )}
          </div>
        )}

        {/* Projects tab */}
        {tab === 'projects' && (
          <div className="space-y-3">
            {data.projects.map(p => (
              <div key={p.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center text-lg">📁</div>
                    <div>
                      <div className="text-sm font-medium text-slate-700">{p.name}</div>
                      <div className="text-xs text-slate-400">{p.taskCount} задач всього</div>
                    </div>
                  </div>
                  {p.activeCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      {p.activeCount} активних
                    </span>
                  )}
                </div>
              </div>
            ))}
            {data.projects.length === 0 && (
              <p className="text-center text-slate-400 py-10">Немає активних проєктів</p>
            )}
          </div>
        )}

        {/* Tasks tab */}
        {tab === 'tasks' && (
          <div className="space-y-3">
            <input
              type="text"
              placeholder="🔍 Пошук задачі, людини, проєкту..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"
            />
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(['all', 'in_progress', 'paused', 'completed'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-600'
                  }`}
                >
                  {s === 'all' ? 'Всі' : s === 'in_progress' ? '▶ В роботі' : s === 'paused' ? '⏸ Пауза' : '✅ Завершено'}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {filteredTasks.map(t => (
                <div key={t.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-700 truncate">{t.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate">
                        {t.userName} · {t.projectName}
                      </div>
                    </div>
                    <div className="shrink-0">{statusBadge(t.status)}</div>
                  </div>
                  {t.weeklyMinutes > 0 && (
                    <div className="mt-1.5 text-xs text-slate-500">⏱ {fmtTime(t.weeklyMinutes)}</div>
                  )}
                </div>
              ))}
              {filteredTasks.length === 0 && (
                <p className="text-center text-slate-400 py-10">Нічого не знайдено</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 z-10">
        <div className="max-w-2xl mx-auto flex">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSearch(''); setStatusFilter('all'); }}
              className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-colors ${
                tab === t.id ? 'text-blue-600' : 'text-slate-400'
              }`}
            >
              <span className="text-lg leading-none">{t.icon}</span>
              <span className="text-[10px] font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
