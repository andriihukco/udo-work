/**
 * Dashboard users CRUD API.
 * All routes protected by x-dashboard-secret header.
 *
 * GET    → list all users
 * POST   → create user { telegramId, role, firstName?, username? }
 * PATCH  → update user { id, role?, firstName? }
 * DELETE → delete user { id }
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';

function auth(request: Request): boolean {
  return request.headers.get('x-dashboard-secret') === process.env.TELEGRAM_WEBHOOK_SECRET;
}

export async function GET(request: Request): Promise<Response> {
  if (!auth(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('users')
    .select('id, telegram_id, role, first_name, username, hourly_rate, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Dashboard GET /users failed', error);
    return Response.json({ error: 'DB error' }, { status: 500 });
  }

  return Response.json({ users: data ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  if (!auth(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { telegramId, role, firstName, username } = body;

    if (!telegramId || !role || !['admin', 'employee'].includes(role)) {
      return Response.json({ error: 'telegramId and valid role required' }, { status: 400 });
    }

    // Check duplicate
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', Number(telegramId))
      .maybeSingle();

    if (existing) {
      return Response.json({ error: 'User already exists' }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('users')
      .insert({
        telegram_id: Number(telegramId),
        role,
        first_name: firstName || null,
        username: username || null,
      })
      .select('id, telegram_id, role, first_name, username, created_at')
      .single();

    if (error || !data) {
      logger.error('Dashboard POST /users failed', error);
      return Response.json({ error: 'Failed to create user' }, { status: 500 });
    }

    return Response.json({ user: data }, { status: 201 });
  } catch (err) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!auth(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { id, role, firstName, hourlyRate } = body;

    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (role && ['admin', 'employee'].includes(role)) updates.role = role;
    if (firstName !== undefined) updates.first_name = firstName || null;
    if (hourlyRate !== undefined) updates.hourly_rate = hourlyRate === null ? null : Number(hourlyRate);

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, telegram_id, role, first_name, username, created_at')
      .single();

    if (error || !data) {
      logger.error('Dashboard PATCH /users failed', error);
      return Response.json({ error: 'Failed to update user' }, { status: 500 });
    }

    return Response.json({ user: data });
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

    const { error } = await supabase.from('users').delete().eq('id', id);

    if (error) {
      logger.error('Dashboard DELETE /users failed', error);
      return Response.json({ error: 'Failed to delete user' }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
