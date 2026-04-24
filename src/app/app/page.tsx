"use client";

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project { id: string; name: string; }

interface ActiveTask {
  id: string;
  name: string;
  projectId: string;
  status: "in_progress" | "paused" | "completed";
  createdAt: string;
}

interface TimeLog {
  id: string;
  task_id: string;
  started_at: string;
  paused_at: string | null;
  ended_at: string | null;
}

interface TodayTask {
  taskName: string;
  projectName: string;
  status: string;
  timeSpent: { hours: number; minutes: number; totalMinutes: number };
}

interface TimerState {
  user: { id: string; name: string; hourlyRate?: number | null; role: "employee" | "admin" } | null;
  activeTask: ActiveTask | null;
  timeLogs: TimeLog[];
  projects: Project[];
  todayTasks: TodayTask[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcElapsedSeconds(timeLogs: TimeLog[]): number {
  let total = 0;
  for (const log of timeLogs) {
    const end = log.paused_at ?? log.ended_at;
    if (!end) {
      total += Math.floor((Date.now() - new Date(log.started_at).getTime()) / 1000);
    } else {
      const diff = Math.floor((new Date(end).getTime() - new Date(log.started_at).getTime()) / 1000);
      if (diff > 0) total += diff;
    }
  }
  return total;
}

function formatHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTotalTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}г ${m}хв`;
  return `${m}хв`;
}

// ---------------------------------------------------------------------------
// Loading screen — shown while role is being determined
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-5 px-6">
      <div className="relative flex items-center justify-center">
        <span className="absolute inline-flex h-16 w-16 rounded-full bg-blue-500 opacity-20 animate-ping" />
        <span className="relative inline-flex h-12 w-12 rounded-full bg-blue-600 items-center justify-center text-2xl">
          ⏱
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="text-white text-sm font-semibold tracking-wide">U:DO Work</div>
        <div className="text-slate-500 text-xs">Завантаження...</div>
      </div>
      <div className="w-32 h-0.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full animate-loading-bar" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin redirect view
// ---------------------------------------------------------------------------

function AdminRedirectView({ name, telegramId }: { name: string; telegramId: number }) {
  const dashboardUrl = `/dashboard?tid=${telegramId}`;
  const firstName = name.split(" ")[0];

  useEffect(() => {
    // Redirect immediately — no countdown needed
    window.location.replace(dashboardUrl);
  }, [dashboardUrl]);

  return (
    <div
      className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center px-6 gap-5 animate-fade-in"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-3xl shadow-lg shadow-blue-900/40">
        🛡️
      </div>
      <div className="text-center">
        <div className="text-xl font-bold">Привіт, {firstName}!</div>
        <div className="text-sm text-slate-400 mt-1">Переходимо до панелі адміністратора...</div>
      </div>
      <div className="w-32 h-0.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full animate-loading-bar" />
      </div>
      <button
        onClick={() => window.location.replace(dashboardUrl)}
        className="mt-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors"
      >
        Відкрити зараз →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AppPage() {
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [state, setState] = useState<TimerState>({
    user: null, activeTask: null, timeLogs: [], projects: [], todayTasks: [],
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNewTask, setShowNewTask] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [taskName, setTaskName] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ---------------------------------------------------------------------------
  // Init — extract Telegram user ID
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let tid: number | null = null;
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.initDataUnsafe?.user?.id) tid = tg.initDataUnsafe.user.id;
    }
    if (!tid) {
      const p = new URLSearchParams(window.location.search).get("tid");
      if (p) tid = Number(p);
    }
    if (tid) setTelegramId(tid);
    else setError("Не вдалося визначити користувача. Відкрийте через Telegram.");
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch state
  // ---------------------------------------------------------------------------
  const fetchState = useCallback(async (tid: number) => {
    try {
      const res = await fetch(`/api/app/timer?telegramId=${tid}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Помилка завантаження");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setState(data);
      setError(null);
      setElapsedSeconds(data.activeTask ? calcElapsedSeconds(data.timeLogs) : 0);
    } catch {
      setError("Помилка мережі");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (telegramId) fetchState(telegramId);
  }, [telegramId, fetchState]);

  // ---------------------------------------------------------------------------
  // Live timer tick
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (state.activeTask?.status !== "in_progress") return;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [state.activeTask?.status]);

  // ---------------------------------------------------------------------------
  // API actions
  // ---------------------------------------------------------------------------
  const doAction = useCallback(async (action: string, extra?: Record<string, string>) => {
    if (!telegramId) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/app/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msgs: Record<string, string> = {
          active_task_exists: "У вас вже є активна задача.",
          no_active_task: "Немає активної задачі.",
          no_paused_task: "Немає задачі на паузі.",
        };
        setError(msgs[data.error] ?? data.error ?? "Помилка");
        return;
      }
      setError(null);
      await fetchState(telegramId);
    } catch {
      setError("Помилка мережі");
    } finally {
      setActionLoading(false);
    }
  }, [telegramId, fetchState]);

  const handleStart = async () => {
    if (!selectedProject || !taskName.trim()) return;
    await doAction("start", { projectId: selectedProject, taskName: taskName.trim() });
    setShowNewTask(false);
    setTaskName("");
    setSelectedProject("");
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const task = state.activeTask;
  const isRunning = task?.status === "in_progress";
  const isPaused = task?.status === "paused";
  const hasTask = !!task;
  const projectName = state.projects.find((p) => p.id === task?.projectId)?.name ?? "";
  const todayTotalMin = state.todayTasks.reduce((s, t) => s + t.timeSpent.totalMinutes, 0);

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  if (loading) return <LoadingScreen />;

  if (error && !state.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6 animate-fade-in">
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="text-white text-base">{error}</div>
        </div>
      </div>
    );
  }

  if (state.user?.role === "admin") {
    return <AdminRedirectView name={state.user.name} telegramId={telegramId!} />;
  }

  // ---------------------------------------------------------------------------
  // Employee view
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col animate-fade-in">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wider">Таймер</div>
          <div className="text-sm font-semibold text-white truncate max-w-[200px]">
            {state.user?.name ?? "—"}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/60 border border-red-700 rounded-lg text-sm text-red-200">
          {error}
        </div>
      )}

      <main
        className="flex-1 flex flex-col items-center px-4 pt-4 pb-6 gap-5"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {/* Active task card */}
        {hasTask ? (
          <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-400 mb-0.5 truncate">{projectName}</div>
                <div className="text-base font-semibold leading-snug break-words">{task.name}</div>
              </div>
              <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
                isRunning ? "bg-green-900/60 text-green-400" : "bg-yellow-900/60 text-yellow-400"
              }`}>
                {isRunning ? "🟢 Активна" : "⏸️ Пауза"}
              </span>
            </div>

            <div className="flex flex-col items-center py-2">
              <div className="text-5xl font-mono font-bold tracking-tight tabular-nums">
                {formatHMS(elapsedSeconds)}
              </div>
              <div className="text-xs text-slate-400 mt-1">витрачено часу</div>
            </div>

            <div className="flex gap-3">
              {isRunning && (
                <button
                  onClick={() => doAction("pause")}
                  disabled={actionLoading}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-xl text-sm font-semibold text-slate-900 transition-colors"
                >
                  ⏸️ Пауза
                </button>
              )}
              {isPaused && (
                <button
                  onClick={() => doAction("resume")}
                  disabled={actionLoading}
                  className="flex-1 py-3 bg-green-500 hover:bg-green-400 disabled:opacity-50 rounded-xl text-sm font-semibold text-slate-900 transition-colors"
                >
                  ▶️ Відновити
                </button>
              )}
              <button
                onClick={() => doAction("complete")}
                disabled={actionLoading}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
              >
                ✅ Завершити
              </button>
            </div>
          </section>
        ) : (
          <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col items-center gap-3">
            <div className="text-4xl">⏱️</div>
            <div className="text-base font-semibold">Немає активної задачі</div>
            <div className="text-sm text-slate-400 text-center">
              Розпочніть нову задачу, щоб почати відстеження часу
            </div>
            {!showNewTask && (
              <button
                onClick={() => setShowNewTask(true)}
                className="mt-1 w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors"
              >
                🚀 Почати задачу
              </button>
            )}
          </section>
        )}

        {/* New task form */}
        {showNewTask && !hasTask && (
          <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4">
            <div className="text-sm font-semibold">📝 Нова задача</div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="project-select">Проєкт</label>
              <select
                id="project-select"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Оберіть проєкт...</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="task-name">Назва задачі</label>
              <input
                id="task-name"
                type="text"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                placeholder="Що будете робити?"
                maxLength={200}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowNewTask(false); setTaskName(""); setSelectedProject(""); }}
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-semibold transition-colors"
              >
                Скасувати
              </button>
              <button
                onClick={handleStart}
                disabled={!selectedProject || !taskName.trim() || actionLoading}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors"
              >
                🚀 Розпочати
              </button>
            </div>
          </section>
        )}

        {/* Today's summary */}
        {state.todayTasks.length > 0 && (
          <section className="w-full">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-300">📅 Сьогодні</div>
              <div className="text-xs text-slate-400">Всього: {formatTotalTime(todayTotalMin)}</div>
            </div>
            <div className="flex flex-col gap-2">
              {state.todayTasks.map((t, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-800 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.taskName}</div>
                    <div className="text-xs text-slate-400 truncate">{t.projectName}</div>
                  </div>
                  <div className="shrink-0 ml-3 text-right">
                    <div className="text-sm font-mono text-slate-300">{formatTotalTime(t.timeSpent.totalMinutes)}</div>
                    <div className={`text-xs ${
                      t.status === "completed" ? "text-green-400"
                      : t.status === "in_progress" ? "text-blue-400"
                      : "text-yellow-400"
                    }`}>
                      {t.status === "completed" ? "✅ Завершено"
                        : t.status === "in_progress" ? "🟢 Активна"
                        : "⏸️ Пауза"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
