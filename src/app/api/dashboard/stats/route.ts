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

    const [usersRes, projectsRes, tasksRes, logsRes] = await Promise.all([
      supabase.from('users').select('id, telegram_id, role, first_name, username, created_at'),
      supabase.from('projects').select('id, name, is_active, created_at'),
      supabase.from('tasks').select('id, project_id, user_id, name, status, created_at'),
      supabase.from('time_logs').select('id, task_id, started_at, paused_at, ended_at').gte('started_at', weekStart),
    ]);

    if (usersRes.error || projectsRes.error || tasksRes.error || logsRes.error) {
      logger.error('Dashboard stats query failed', { usersRes, projectsRes, tasksRes, logsRes });
      return Response.json({ error: 'Database error' }, { status: 500 });
    }

    const users = usersRes.data ?? [];
    const projects = projectsRes.data ?? [];
    const tasks = tasksRes.data ?? [];
    const logs = logsRes.data ?? [];

    // Compute weekly minutes per user
    const taskUserMap = new Map(tasks.map((t: any) => [t.id, t.user_id]));
    const minutesByUser = new Map<string, number>();
    for (const log of logs as any[]) {
      const userId = taskUserMap.get(log.task_id);
      if (!userId) continue;
      const endStr = log.paused_at ?? log.ended_at;
      if (!endStr) continue;
      const diff = Math.floor((new Date(endStr).getTime() - new Date(log.started_at).getTime()) / 60000);
      if (diff > 0) minutesByUser.set(userId, (minutesByUser.get(userId) ?? 0) + diff);
    }

    const employees = users
      .filter((u: any) => u.role === 'employee')
      .map((u: any) => ({
        id: u.id,
        name: u.first_name ?? (u.username ? `@${u.username}` : `ID ${u.telegram_id}`),
        username: u.username,
        weeklyMinutes: minutesByUser.get(u.id) ?? 0,
        activeTasks: tasks.filter((t: any) => t.user_id === u.id && t.status === 'in_progress').length,
      }));

    const activeProjects = projects.filter((p: any) => p.is_active);

    // Recent tasks with time
    const recentTasks = tasks
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50)
      .map((t: any) => {
        const project = projects.find((p: any) => p.id === t.project_id);
        const user = users.find((u: any) => u.id === t.user_id);
        const taskLogs = (logs as any[]).filter((l) => l.task_id === t.id);
        const totalMin = taskLogs.reduce((sum: number, l: any) => {
          const endStr = l.paused_at ?? l.ended_at;
          if (!endStr) return sum;
          const diff = Math.floor((new Date(endStr).getTime() - new Date(l.started_at).getTime()) / 60000);
          return sum + (diff > 0 ? diff : 0);
        }, 0);
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          projectName: project?.name ?? '—',
          userName: user?.first_name ?? (user?.username ? `@${user.username}` : '—'),
          createdAt: t.created_at,
          weeklyMinutes: totalMin,
        };
      });

    return Response.json({
      summary: {
        totalEmployees: employees.length,
        totalAdmins: users.filter((u: any) => u.role === 'admin').length,
        activeProjects: activeProjects.length,
        inProgressTasks: tasks.filter((t: any) => t.status === 'in_progress').length,
        completedThisWeek: tasks.filter((t: any) => t.status === 'completed').length,
      },
      employees,
      projects: activeProjects.map((p: any) => ({
        id: p.id,
        name: p.name,
        taskCount: tasks.filter((t: any) => t.project_id === p.id).length,
        activeCount: tasks.filter((t: any) => t.project_id === p.id && t.status === 'in_progress').length,
      })),
      recentTasks,
    });
  } catch (err) {
    logger.error('Dashboard stats error', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
