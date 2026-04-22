/**
 * Dashboard stats API — returns summary data for the admin mini app.
 * Protected by DASHBOARD_SECRET header.
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { getStartOfWeek } from '@/lib/utils/time';

export async function GET(request: Request): Promise<Response> {
  const secret = request.headers.get('x-dashboard-secret');
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const weekStart = getStartOfWeek().toISOString();

    // Fetch all time_logs (not just this week) so we can compute total time per task
    const [usersRes, projectsRes, tasksRes, allLogsRes, weekLogsRes] = await Promise.all([
      supabase.from('users').select('id, telegram_id, role, first_name, username, created_at'),
      supabase.from('projects').select('id, name, is_active, created_at'),
      supabase.from('tasks').select('id, project_id, user_id, name, status, created_at'),
      supabase.from('time_logs').select('id, task_id, started_at, paused_at, ended_at'),
      supabase.from('time_logs').select('id, task_id, started_at, paused_at, ended_at').gte('started_at', weekStart),
    ]);

    if (usersRes.error || projectsRes.error || tasksRes.error || allLogsRes.error || weekLogsRes.error) {
      logger.error('Dashboard stats query failed', { usersRes, projectsRes, tasksRes, allLogsRes });
      return Response.json({ error: 'Database error' }, { status: 500 });
    }

    const users = usersRes.data ?? [];
    const projects = projectsRes.data ?? [];
    const tasks = tasksRes.data ?? [];
    const allLogs = allLogsRes.data ?? [];
    const weekLogs = weekLogsRes.data ?? [];

    // Helper: compute total minutes from a set of logs
    const calcMinutes = (logs: any[]): number => {
      return logs.reduce((sum: number, l: any) => {
        const endStr = l.paused_at ?? l.ended_at;
        if (!endStr) return sum;
        const diff = Math.floor((new Date(endStr).getTime() - new Date(l.started_at).getTime()) / 60000);
        return sum + (diff > 0 ? diff : 0);
      }, 0);
    }

    // Weekly minutes per user (for leaderboard)
    const taskUserMap = new Map(tasks.map((t: any) => [t.id, t.user_id]));
    const weekMinutesByUser = new Map<string, number>();
    for (const log of weekLogs as any[]) {
      const userId = taskUserMap.get(log.task_id);
      if (!userId) continue;
      const endStr = log.paused_at ?? log.ended_at;
      if (!endStr) continue;
      const diff = Math.floor((new Date(endStr).getTime() - new Date(log.started_at).getTime()) / 60000);
      if (diff > 0) weekMinutesByUser.set(userId, (weekMinutesByUser.get(userId) ?? 0) + diff);
    }

    const employees = users
      .filter((u: any) => u.role === 'employee')
      .map((u: any) => ({
        id: u.id,
        name: u.first_name ?? (u.username ? `@${u.username}` : `ID ${u.telegram_id}`),
        username: u.username,
        weeklyMinutes: weekMinutesByUser.get(u.id) ?? 0,
        activeTasks: tasks.filter((t: any) => t.user_id === u.id && t.status === 'in_progress').length,
      }));

    const activeProjects = projects.filter((p: any) => p.is_active);

    // Group all logs by task_id for fast lookup
    const logsByTask = new Map<string, any[]>();
    for (const log of allLogs as any[]) {
      if (!logsByTask.has(log.task_id)) logsByTask.set(log.task_id, []);
      logsByTask.get(log.task_id)!.push(log);
    }

    // Build enriched task list (all tasks, sorted by created_at desc, limit 100)
    const recentTasks = [...tasks]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 100)
      .map((t: any) => {
        const project = projects.find((p: any) => p.id === t.project_id);
        const user = users.find((u: any) => u.id === t.user_id);
        const taskLogs = logsByTask.get(t.id) ?? [];
        const totalMinutes = calcMinutes(taskLogs);

        // First log started_at = when work actually began
        const sortedLogs = [...taskLogs].sort((a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
        );
        const startedAt = sortedLogs[0]?.started_at ?? t.created_at;

        // Last ended_at = when completed (null if still active/paused)
        const completedAt = t.status === 'completed'
          ? (taskLogs.find((l: any) => l.ended_at)?.ended_at ?? null)
          : null;

        // Currently active interval (no end timestamp)
        const activeLog = taskLogs.find((l: any) => !l.paused_at && !l.ended_at);
        const activeMinutes = activeLog
          ? Math.floor((Date.now() - new Date(activeLog.started_at).getTime()) / 60000)
          : 0;

        return {
          id: t.id,
          name: t.name,
          status: t.status,
          projectName: project?.name ?? '—',
          projectId: t.project_id,
          userName: user?.first_name ?? (user?.username ? `@${user.username}` : '—'),
          userId: t.user_id,
          createdAt: t.created_at,
          startedAt,
          completedAt,
          totalMinutes,        // all closed intervals
          activeMinutes,       // currently running (if in_progress)
          logCount: taskLogs.length,
        };
      });

    return Response.json({
      summary: {
        totalEmployees: employees.length,
        totalAdmins: users.filter((u: any) => u.role === 'admin').length,
        activeProjects: activeProjects.length,
        inProgressTasks: tasks.filter((t: any) => t.status === 'in_progress').length,
        completedThisWeek: tasks.filter((t: any) => {
          if (t.status !== 'completed') return false;
          const logs = logsByTask.get(t.id) ?? [];
          return logs.some((l: any) => l.ended_at && l.ended_at >= weekStart);
        }).length,
      },
      employees,
      projects: activeProjects.map((p: any) => ({
        id: p.id,
        name: p.name,
        taskCount: tasks.filter((t: any) => t.project_id === p.id).length,
        activeCount: tasks.filter((t: any) => t.project_id === p.id && t.status === 'in_progress').length,
        totalMinutes: calcMinutes(
          (allLogs as any[]).filter((l) => {
            const task = tasks.find((t: any) => t.id === l.task_id);
            return task?.project_id === p.id;
          })
        ),
      })),
      recentTasks,
    });
  } catch (err) {
    logger.error('Dashboard stats error', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
