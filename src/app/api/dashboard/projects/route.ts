/**
 * Dashboard projects CRUD API.
 * All routes protected by x-dashboard-secret header.
 *
 * GET    → list all projects (active + inactive)
 * POST   → create project { name }
 * PATCH  → update project { id, is_active?, name? }
 * DELETE → delete project { id }
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';

function auth(request: Request): boolean {
  return request.headers.get('x-dashboard-secret') === process.env.TELEGRAM_WEBHOOK_SECRET;
}

export async function GET(request: Request): Promise<Response> {
  if (!auth(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, is_active, created_at')
    .order('name');

  if (error) {
    logger.error('Dashboard GET /projects failed', error);
    return Response.json({ error: 'DB error' }, { status: 500 });
  }

  return Response.json({ projects: data ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  if (!auth(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { name } = body;

    if (!name?.trim()) {
      return Response.json({ error: 'name required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('projects')
      .insert({ name: name.trim(), is_active: true })
      .select('id, name, is_active, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return Response.json({ error: 'Project with this name already exists' }, { status: 409 });
      }
      logger.error('Dashboard POST /projects failed', error);
      return Response.json({ error: 'Failed to create project' }, { status: 500 });
    }

    return Response.json({ project: data }, { status: 201 });
  } catch (err) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!auth(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { id, is_active, name } = body;

    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (typeof is_active === 'boolean') updates.is_active = is_active;
    if (name?.trim()) updates.name = name.trim();

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select('id, name, is_active, created_at')
      .single();

    if (error || !data) {
      logger.error('Dashboard PATCH /projects failed', error);
      return Response.json({ error: 'Failed to update project' }, { status: 500 });
    }

    return Response.json({ project: data });
  } catch (err) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!auth(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const { error } = await supabase.from('projects').delete().eq('id', id);

    if (error) {
      logger.error('Dashboard DELETE /projects failed', error);
      return Response.json({ error: 'Failed to delete project' }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
