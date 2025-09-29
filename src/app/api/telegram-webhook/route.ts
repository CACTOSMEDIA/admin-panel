import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const update = await req.json();
  const supabase = supabaseServer();

  const from = update?.message?.from || update?.callback_query?.from;
  const tg_id = from?.id;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Usuario';

  if (tg_id) {
    await supabase.from('users').upsert({ tg_id, name, role: 'client' }, { onConflict: 'tg_id' });
  }

  // TODO: flujo Comprar/Vender, subir capture, etc.
  return NextResponse.json({ ok: true });
}
