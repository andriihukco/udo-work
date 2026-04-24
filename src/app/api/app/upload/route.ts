/**
 * Mini app file upload endpoint.
 * Accepts multipart/form-data with fields: telegramId, taskId, file
 * Uploads the file to Supabase Storage and saves an attachment record.
 */

import { supabase } from '@/lib/db/client';
import { storageService } from '@/lib/services/storage.service';
import { logger } from '@/lib/utils/logger';
import { StorageError, FileTooLargeError } from '@/types/index';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

async function resolveUser(telegramId: number) {
  const { data, error } = await supabase
    .from('users')
    .select('id, telegram_id, role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const telegramId = Number(formData.get('telegramId'));
    const taskId = formData.get('taskId') as string | null;
    const file = formData.get('file') as File | null;

    if (!telegramId || !taskId || !file) {
      return Response.json({ error: 'telegramId, taskId and file required' }, { status: 400 });
    }

    const user = await resolveUser(telegramId);
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 403 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: 'file_too_large', maxMb: 20 }, { status: 413 });
    }

    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!bucket) {
      return Response.json({ error: 'Storage not configured' }, { status: 500 });
    }

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${user.id}/${taskId}/${timestamp}-${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      logger.error('Mini app upload: storage error', uploadError);
      return Response.json({ error: 'Upload failed' }, { status: 500 });
    }

    // Signed URL valid for 7 days
    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 604800);

    if (signedError || !signedData?.signedUrl) {
      logger.error('Mini app upload: signed URL error', signedError);
      return Response.json({ error: 'Failed to generate URL' }, { status: 500 });
    }

    await storageService.saveFileAttachment(taskId, signedData.signedUrl, file.name);

    return Response.json({ ok: true, url: signedData.signedUrl, fileName: file.name });
  } catch (err) {
    logger.error('Mini app upload error', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
