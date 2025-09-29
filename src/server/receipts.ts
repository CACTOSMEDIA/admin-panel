import { supabaseServer } from '@/lib/supabaseServer';
import { randomUUID } from 'crypto';

export async function uploadReceiptBuffer(txId: string, buf: Buffer, mime = 'image/jpeg') {
  const supabase = supabaseServer();
  const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1] || 'jpg';
  const path = `tx/${txId}/${randomUUID()}.${ext}`;

  const { data, error } = await supabase
    .storage.from('receipts')
    .upload(path, buf, { contentType: mime, upsert: false });

  if (error) throw error;

  const filePath = data.path;
  const { error: err2 } = await supabase
    .from('receipts')
    .insert({ transaction_id: txId, file_url: filePath });
  if (err2) throw err2;

  return filePath;
}

export async function createSignedUrl(path: string, expiresIn = 600) {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .storage
    .from('receipts')
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
