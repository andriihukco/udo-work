/**
 * Dashboard auth — verifies a Telegram user is an admin.
 * POST { telegramId: number } → { ok: true, user } | { ok: false }
 * Protected by x-dashboard-secret header.
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get('x-dashboard-secret');
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const telegramId = Number(body?.telegramId);
    if (!telegramId || isNaN(telegramId)) {
      return Response.json({ ok: false, error: 'Invalid telegramId' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, telegram_id, role, first_name, username')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error) {
      logger.error('Dashboard auth query failed', error);
      return Response.json({ ok: false, error: 'DB error' }, { status: 500 });
    }

    if (!data || data.role !== 'admin') {
      return Response.json({ ok: false, error: 'Not an admin' }, { status: 403 });
    }

    return Response.json({ ok: true, user: data });
  } catch (err) {
    logger.error('Dashboard auth error', err);
    return Response.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
