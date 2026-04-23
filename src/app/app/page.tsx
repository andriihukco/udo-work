"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
}

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
// Pomodoro settings
// ---------------------------------------------------------------------------
const POMODORO_WORK_MIN = 25;
const POMODORO_BREAK_MIN = 5;
const POMODORO_LONG_BREAK_MIN = 15;
const POMODOROS_BEFORE_LONG = 4;

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
      const diff = Math.floor(
        (new Date(end).getTime() - new Date(log.started_at).getTime()) / 1000
      );
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

function formatMinSec(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTotalTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}г ${m}хв`;
  return `${m}хв`;
}

// ---------------------------------------------------------------------------
// Admin redirect view
// ---------------------------------------------------------------------------

function AdminRedirectView({ name, telegramId }: { name: string; telegramId: number }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center px-6 gap-6">
      <div className="text-5xl">🛡️</div>
      <div className="text-center">
        <div className="text-lg font-bold mb-1">{name}</div>
        <div className="text-sm text-slate-400">Адміністратор</div>
      </div>
      <div className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-3">
        <div className="text-sm text-slate-300 text-center mb-1">
          Для адміністраторів доступний повний дашборд
        </div>
        <a
          href={`/dashboard?tid=${telegramId}`}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold text-center transition-colors block"
        >
          📊 Відкрити дашборд
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AppPage() {
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [state, setState] = useState<TimerState>({
    user: null,
    activeTask: null,
    timeLogs: [],
    projects: [],
    todayTasks: [],
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Task creation form
  const [showNewTask, setShowNewTask] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [taskName, setTaskName] = useState("");

  // Live elapsed seconds (ticks every second when in_progress)
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Pomodoro mode
  const [pomodoroMode, setPomodoroMode] = useState(false);
  const [pomodoroPhase, setPomodoroPhase] = useState<"work" | "break" | "long_break">("work");
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const [pomodoroSecondsLeft, setPomodoroSecondsLeft] = useState(POMODORO_WORK_MIN * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const pomodoroRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Notification permission
  const [notifGranted, setNotifGranted] = useState(false);

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let tid: number | null = null;

    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      const initData = tg.initDataUnsafe;
      if (initData?.user?.id) {
        tid = initData.user.id;
      }
    }

    if (!tid) {
      const params = new URLSearchParams(window.location.search);
      const param = params.get("tid");
      if (param) tid = Number(param);
    }

    if (tid) setTelegramId(tid);
    else setError("Не вдалося визначити користувача. Відкрийте через Telegram.");

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then((p) => setNotifGranted(p === "granted"));
    } else if ("Notification" in window && Notification.permission === "granted") {
      setNotifGranted(true);
    }
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

      if (data.activeTask) {
        setElapsedSeconds(calcElapsedSeconds(data.timeLogs));
      } else {
        setElapsedSeconds(0);
      }
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
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [state.activeTask?.status]);

  // ---------------------------------------------------------------------------
  // Pomodoro timer
  // ---------------------------------------------------------------------------
  const startPomodoro = useCallback(() => setPomodoroRunning(true), []);
  const pausePomodoro = useCallback(() => setPomodoroRunning(false), []);
  const resetPomodoro = useCallback(() => {
    setPomodoroRunning(false);
    setPomodoroPhase("work");
    setPomodoroSecondsLeft(POMODORO_WORK_MIN * 60);
  }, []);

  const skipPhase = useCallback(() => {
    setPomodoroRunning(false);
    if (pomodoroPhase === "work") {
      const next = pomodoroCount + 1;
      setPomodoroCount(next);
      if (next % POMODOROS_BEFORE_LONG === 0) {
        setPomodoroPhase("long_break");
        setPomodoroSecondsLeft(POMODORO_LONG_BREAK_MIN * 60);
      } else {
        setPomodoroPhase("break");
        setPomodoroSecondsLeft(POMODORO_BREAK_MIN * 60);
      }
    } else {
      setPomodoroPhase("work");
      setPomodoroSecondsLeft(POMODORO_WORK_MIN * 60);
    }
  }, [pomodoroPhase, pomodoroCount]);

  useEffect(() => {
    if (!pomodoroRunning) {
      if (pomodoroRef.current) clearInterval(pomodoroRef.current);
      return;
    }
    pomodoroRef.current = setInterval(() => {
      setPomodoroSecondsLeft((s) => {
        if (s <= 1) {
          if (notifGranted) {
            const msg =
              pomodoroPhase === "work"
                ? "🍅 Помодоро завершено! Час відпочити."
                : "▶️ Перерва закінчилась. Час працювати!";
            new Notification(msg);
          }
          skipPhase();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (pomodoroRef.current) clearInterval(pomodoroRef.current);
    };
  }, [pomodoroRunning, pomodoroPhase, skipPhase, notifGranted]);

  // ---------------------------------------------------------------------------
  // API actions
  // ---------------------------------------------------------------------------
  const doAction = useCallback(
    async (action: string, extra?: Record<string, string>) => {
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
    },
    [telegramId, fetchState]
  );

  const handleStart = async () => {
    if (!selectedProject || !taskName.trim()) return;
    await doAction("start", { projectId: selectedProject, taskName: taskName.trim() });
    setShowNewTask(false);
    setTaskName("");
    setSelectedProject("");
    if (pomodoroMode) {
      setPomodoroPhase("work");
      setPomodoroSecondsLeft(POMODORO_WORK_MIN * 60);
      setPomodoroRunning(true);
    }
  };

  const handlePause = async () => {
    await doAction("pause");
    if (pomodoroMode) pausePomodoro();
  };

  const handleResume = async () => {
    await doAction("resume");
    if (pomodoroMode) startPomodoro();
  };

  const handleComplete = async () => {
    await doAction("complete");
    if (pomodoroMode) resetPomodoro();
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const task = state.activeTask;
  const isRunning = task?.status === "in_progress";
  const isPaused = task?.status === "paused";
  const hasTask = !!task;
  const projectName =
    state.projects.find((p) => p.id === task?.projectId)?.name ?? "";

  // Pomodoro ring
  const pomodoroTotal =
    pomodoroPhase === "work"
      ? POMODORO_WORK_MIN * 60
      : pomodoroPhase === "break"
      ? POMODORO_BREAK_MIN * 60
      : POMODORO_LONG_BREAK_MIN * 60;
  const pomodoroProgress = 1 - pomodoroSecondsLeft / pomodoroTotal;
  const RADIUS = 88;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const strokeDashoffset = CIRCUMFERENCE * (1 - pomodoroProgress);

  const phaseLabel =
    pomodoroPhase === "work" ? "Робота" : pomodoroPhase === "break" ? "Коротка перерва" : "Довга перерва";
  const phaseColor = pomodoroPhase === "work" ? "#ef4444" : "#22c55e";

  const todayTotalMin = state.todayTasks.reduce((s, t) => s + t.timeSpent.totalMinutes, 0);

  // ---------------------------------------------------------------------------
  // Loading / error screens
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white text-lg animate-pulse">Завантаження...</div>
      </div>
    );
  }

  if (error && !state.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="text-white text-base">{error}</div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Admin view — redirect to dashboard
  // ---------------------------------------------------------------------------
  if (state.user?.role === "admin") {
    return <AdminRedirectView name={state.user.name} telegramId={telegramId!} />;
  }

  // ---------------------------------------------------------------------------
  // Employee view
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wider">Таймер</div>
          <div className="text-sm font-semibold text-white truncate max-w-[180px]">
            {state.user?.name ?? "—"}
          </div>
        </div>
        <button
          onClick={() => setPomodoroMode((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            pomodoroMode ? "bg-red-500 text-white" : "bg-slate-700 text-slate-300"
          }`}
          aria-label="Перемкнути режим Pomodoro"
        >
          🍅 {pomodoroMode ? "Pomodoro ON" : "Pomodoro"}
        </button>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/60 border border-red-700 rounded-lg text-sm text-red-200">
          {error}
        </div>
      )}

      <main className="flex-1 flex flex-col items-center px-4 pt-4 pb-6 gap-6">

        {/* ------------------------------------------------------------------ */}
        {/* POMODORO MODE */}
        {/* ------------------------------------------------------------------ */}
        {pomodoroMode && (
          <section className="w-full flex flex-col items-center gap-4">
            <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
              <svg width="220" height="220" className="absolute top-0 left-0 -rotate-90">
                <circle cx="110" cy="110" r={RADIUS} fill="none" stroke="#1e293b" strokeWidth="12" />
                <circle
                  cx="110" cy="110" r={RADIUS}
                  fill="none"
                  stroke={phaseColor}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={strokeDashoffset}
                  style={{ transition: "stroke-dashoffset 0.5s ease" }}
                />
              </svg>
              <div className="flex flex-col items-center z-10">
                <div className="text-4xl font-mono font-bold tracking-tight">
                  {formatMinSec(pomodoroSecondsLeft)}
                </div>
                <div className="text-xs text-slate-400 mt-1">{phaseLabel}</div>
                <div className="text-xs text-slate-500 mt-0.5">🍅 ×{pomodoroCount}</div>
              </div>
            </div>

            <div className="flex gap-3">
              {!pomodoroRunning ? (
                <button
                  onClick={startPomodoro}
                  className="px-6 py-2.5 bg-red-500 hover:bg-red-600 rounded-full text-sm font-semibold transition-colors"
                  aria-label="Запустити Pomodoro"
                >
                  ▶️ Старт
                </button>
              ) : (
                <button
                  onClick={pausePomodoro}
                  className="px-6 py-2.5 bg-slate-600 hover:bg-slate-500 rounded-full text-sm font-semibold transition-colors"
                  aria-label="Пауза Pomodoro"
                >
                  ⏸️ Пауза
                </button>
              )}
              <button
                onClick={skipPhase}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-full text-sm font-semibold transition-colors"
                aria-label="Пропустити фазу"
              >
                ⏭️ Пропустити
              </button>
              <button
                onClick={resetPomodoro}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-full text-sm font-semibold transition-colors"
                aria-label="Скинути Pomodoro"
              >
                🔄
              </button>
            </div>

            <div className="flex gap-4 text-xs text-slate-400">
              <span>🔴 {POMODORO_WORK_MIN}хв робота</span>
              <span>🟢 {POMODORO_BREAK_MIN}хв перерва</span>
              <span>🔵 {POMODORO_LONG_BREAK_MIN}хв довга</span>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* ACTIVE TASK CARD */}
        {/* ------------------------------------------------------------------ */}
        {hasTask ? (
          <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4">
            {/* Task info */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-400 mb-0.5 truncate">{projectName}</div>
                <div className="text-base font-semibold leading-snug break-words">{task.name}</div>
              </div>
              <span
                className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
                  isRunning
                    ? "bg-green-900/60 text-green-400"
                    : "bg-yellow-900/60 text-yellow-400"
                }`}
              >
                {isRunning ? "🟢 Активна" : "⏸️ Пауза"}
              </span>
            </div>

            {/* Elapsed time */}
            <div className="flex flex-col items-center py-2">
              <div className="text-5xl font-mono font-bold tracking-tight tabular-nums">
                {formatHMS(elapsedSeconds)}
              </div>
              <div className="text-xs text-slate-400 mt-1">витрачено часу</div>
            </div>

            {/* Context-aware action buttons */}
            <div className="flex gap-3">
              {isRunning && (
                <button
                  onClick={handlePause}
                  disabled={actionLoading}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-xl text-sm font-semibold text-slate-900 transition-colors"
                  aria-label="Поставити на паузу"
                >
                  ⏸️ Пауза
                </button>
              )}
              {isPaused && (
                <button
                  onClick={handleResume}
                  disabled={actionLoading}
                  className="flex-1 py-3 bg-green-500 hover:bg-green-400 disabled:opacity-50 rounded-xl text-sm font-semibold text-slate-900 transition-colors"
                  aria-label="Відновити задачу"
                >
                  ▶️ Відновити
                </button>
              )}
              <button
                onClick={handleComplete}
                disabled={actionLoading}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
                aria-label="Завершити задачу"
              >
                ✅ Завершити
              </button>
            </div>
          </section>
        ) : (
          /* No active task */
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
                aria-label="Почати нову задачу"
              >
                🚀 Почати задачу
              </button>
            )}
          </section>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* NEW TASK FORM — only shown when no active task */}
        {/* ------------------------------------------------------------------ */}
        {showNewTask && !hasTask && (
          <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4">
            <div className="text-sm font-semibold">📝 Нова задача</div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="project-select">
                Проєкт
              </label>
              <select
                id="project-select"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                aria-label="Оберіть проєкт"
              >
                <option value="">Оберіть проєкт...</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="task-name">
                Назва задачі
              </label>
              <input
                id="task-name"
                type="text"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                placeholder="Що будете робити?"
                maxLength={200}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                aria-label="Назва задачі"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowNewTask(false); setTaskName(""); setSelectedProject(""); }}
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-semibold transition-colors"
                aria-label="Скасувати"
              >
                ❌ Скасувати
              </button>
              <button
                onClick={handleStart}
                disabled={!selectedProject || !taskName.trim() || actionLoading}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors"
                aria-label="Розпочати задачу"
              >
                🚀 Розпочати
              </button>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* TODAY'S SUMMARY */}
        {/* ------------------------------------------------------------------ */}
        {state.todayTasks.length > 0 && (
          <section className="w-full">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-300">📅 Сьогодні</div>
              <div className="text-xs text-slate-400">
                Всього: {formatTotalTime(todayTotalMin)}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {state.todayTasks.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between bg-slate-800 rounded-xl px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.taskName}</div>
                    <div className="text-xs text-slate-400 truncate">{t.projectName}</div>
                  </div>
                  <div className="shrink-0 ml-3 text-right">
                    <div className="text-sm font-mono text-slate-300">
                      {formatTotalTime(t.timeSpent.totalMinutes)}
                    </div>
                    <div
                      className={`text-xs ${
                        t.status === "completed"
                          ? "text-green-400"
                          : t.status === "in_progress"
                          ? "text-blue-400"
                          : "text-yellow-400"
                      }`}
                    >
                      {t.status === "completed"
                        ? "✅ Завершено"
                        : t.status === "in_progress"
                        ? "🟢 Активна"
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
