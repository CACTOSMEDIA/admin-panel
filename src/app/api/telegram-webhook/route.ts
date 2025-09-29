import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// Helpers Telegram
async function tgSend(chat_id: number | string, text: string, markup?: any) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'Markdown', reply_markup: markup })
  });
  if (!res.ok) console.error('tgSend fail', await res.text());
}

async function tgGetFile(file_id: string) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${file_id}`);
  const j = await r.json();
  if (!j.ok) throw new Error('getFile failed');
  const path = j.result.file_path as string;
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`;
  const fileRes = await fetch(url);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  // content-type aproximado
  const mime = path.endsWith('.pdf') ? 'application/pdf'
    : path.endsWith('.png') ? 'image/png'
    : 'image/jpeg';
  return { buf, mime };
}

// Utilidades de DB
async function getCurrentRates(supabase: ReturnType<typeof supabaseServer>) {
  const { data } = await supabase
    .from('rates')
    .select('buy_rate,sell_rate')
    .is('valid_to', null)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const update = await req.json();
  const supabase = supabaseServer();

  // Quién habla
  const msg = update.message ?? update.edited_message ?? update.callback_query?.message;
  const chatId = msg?.chat?.id;
  const from = update.message?.from ?? update.callback_query?.from;
  const tg_id = from?.id as number | undefined;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Usuario';

  // Asegura usuario en DB
  if (tg_id) {
    await supabase.from('users').upsert({ tg_id, name, role: 'client' }, { onConflict: 'tg_id' });
  }

  // 1) CALLBACKS (elige método/ cuenta)
  if (update.callback_query) {
    const data: string = update.callback_query.data;
    // form: METHOD:bank | METHOD:zelle
    // form: RCV:<receive_account_id>
    if (data.startsWith('METHOD:')) {
      const method = data.split(':')[1]; // bank|zelle
      // listar cuentas del negocio
      const { data: accs } = await supabase.from('receive_accounts')
        .select('id,label,bank_name,account_number,zelle_user,zelle_holder,currency,active')
        .eq('active', true);

      if (!accs || accs.length === 0) {
        await tgSend(chatId, 'No hay cuentas disponibles. Contacta soporte.');
        return NextResponse.json({ ok: true });
      }
      const keyboard = accs.map(a => [{ text: a.label ?? a.bank_name ?? 'Cuenta', callback_data: `RCV:${a.id}:${method}` }]);
      await tgSend(chatId, 'Elige la cuenta destino para tu pago:', { inline_keyboard: keyboard });
      return NextResponse.json({ ok: true });
    }

    if (data.startsWith('RCV:')) {
      // callback data: RCV:<account_id>:<method>
      const [, accId, method] = data.split(':');
      // Obtén última intención (monto y tipo) guardada en draft por este usuario
      // Estrategia simple: busca última transacción PENDING creada en los últimos 30 min sin account asignada
      const { data: lastTx } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', (await supabase.from('users').select('id').eq('tg_id', tg_id!).maybeSingle()).data?.id)
        .eq('status','pending')
        .is('target_receive_account', null)
        .order('created_at', { ascending:false })
        .limit(1)
        .maybeSingle();

      if (!lastTx) {
        await tgSend(chatId, 'No encontré una transacción pendiente. Inicia con /comprar o /vender.');
        return NextResponse.json({ ok: true });
      }

      await supabase.from('transactions')
        .update({ method, target_receive_account: accId })
        .eq('id', lastTx.id);

      // Muestra datos de la cuenta seleccionada
      const { data: acc } = await supabase.from('receive_accounts').select('*').eq('id', accId).maybeSingle();
      const detail =
        method === 'zelle'
          ? `Paga por *Zelle*\nUsuario: \`${acc?.zelle_user ?? '—'}\`\nTitular: *${acc?.zelle_holder ?? '—'}*\nMoneda: ${acc?.currency}`
          : `Transferencia bancaria\nBanco: *${acc?.bank_name ?? '—'}*\nCuenta: \`${acc?.account_number ?? '—'}\`\nMoneda: ${acc?.currency}`;

      await tgSend(chatId, `${detail}\n\n*Sube tu captura de pago* (foto o PDF) en este chat.`);
      return NextResponse.json({ ok: true });
    }
  }

  // 2) MENSAJES DE TEXTO (comandos)
  const text: string | undefined = update.message?.text;
  if (text && chatId) {
    // /start (admite deep-link ref_XXX)
    if (text.startsWith('/start')) {
      await tgSend(chatId, '¡Bienvenido! Usa:\n/tasas – Ver tasas\n/comprar 100 – Cotiza para comprar USD\n/vender 120 – Cotiza para vender USD');
      return NextResponse.json({ ok: true });
    }

    // /tasas
    if (text.startsWith('/tasas')) {
      const r = await getCurrentRates(supabase);
      if (!r) {
        await tgSend(chatId, 'Aún no hay tasas activas. (Admin: usa /set_compra y /set_venta)');
      } else {
        await tgSend(chatId, `Tasas actuales:\nCompra: *${r.buy_rate}*\nVenta: *${r.sell_rate}*`);
      }
      return NextResponse.json({ ok: true });
    }

    // /set_compra X.YY  (solo admin)
    if (text.startsWith('/set_compra')) {
      const isAdmin = (await supabase.from('users').select('role').eq('tg_id', tg_id!).maybeSingle()).data?.role === 'admin';
      if (!isAdmin) { await tgSend(chatId, 'Solo admin.'); return NextResponse.json({ ok: true }); }
      const val = Number(text.split(' ')[1]);
      if (!val) { await tgSend(chatId, 'Uso: /set_compra 36.15'); return NextResponse.json({ ok: true }); }
      // cierra vigente e inserta nueva con misma venta actual (si existe)
      const cur = await getCurrentRates(supabase);
      await supabase.from('rates').update({ valid_to: new Date().toISOString() }).is('valid_to', null);
      await supabase.from('rates').insert({ buy_rate: val, sell_rate: cur?.sell_rate ?? val + 0.5 });
      await tgSend(chatId, `OK. Tasa de *compra* actualizada a ${val}.`);
      return NextResponse.json({ ok: true });
    }

    // /set_venta X.YY  (solo admin)
    if (text.startsWith('/set_venta')) {
      const isAdmin = (await supabase.from('users').select('role').eq('tg_id', tg_id!).maybeSingle()).data?.role === 'admin';
      if (!isAdmin) { await tgSend(chatId, 'Solo admin.'); return NextResponse.json({ ok: true }); }
      const val = Number(text.split(' ')[1]);
      if (!val) { await tgSend(chatId, 'Uso: /set_venta 37.10'); return NextResponse.json({ ok: true }); }
      const cur = await getCurrentRates(supabase);
      await supabase.from('rates').update({ valid_to: new Date().toISOString() }).is('valid_to', null);
      await supabase.from('rates').insert({ buy_rate: cur?.buy_rate ?? val - 0.5, sell_rate: val });
      await tgSend(chatId, `OK. Tasa de *venta* actualizada a ${val}.`);
      return NextResponse.json({ ok: true });
    }

    // /comprar 100  (cliente quiere COMPRAR USD → tú VENDES USD)
    if (text.startsWith('/comprar')) {
      const amount = Number(text.split(' ')[1]);
      const r = await getCurrentRates(supabase);
      if (!r || !amount) { await tgSend(chatId, 'Uso: /comprar 100'); return NextResponse.json({ ok: true }); }
      const totalLocal = amount * Number(r.sell_rate); // vendes USD a tasa de venta
      // crea draft/pending
      const u = await supabase.from('users').select('id').eq('tg_id', tg_id!).maybeSingle();
      const { data: tx } = await supabase.from('transactions').insert({
        user_id: u.data?.id,
        type: 'SELL',                // negocio vende USD
        amount_currency: 'USD',
        amount_value: amount,
        rate_snapshot: r.sell_rate,
        method: 'bank',
        status: 'pending'
      }).select('id').maybeSingle();

      await tgSend(chatId, `Total a pagar en moneda local: *${totalLocal.toFixed(2)}*.\nElige método:`, {
        inline_keyboard: [
          [{ text: 'Transferencia bancaria', callback_data: 'METHOD:bank' }],
          [{ text: 'Zelle', callback_data: 'METHOD:zelle' }]
        ]
      });
      return NextResponse.json({ ok: true });
    }

    // /vender 120  (cliente quiere VENDER USD → tú COMPRAS USD)
    if (text.startsWith('/vender')) {
      const amount = Number(text.split(' ')[1]);
      const r = await getCurrentRates(supabase);
      if (!r || !amount) { await tgSend(chatId, 'Uso: /vender 120'); return NextResponse.json({ ok: true }); }
      const totalLocal = amount * Number(r.buy_rate); // compras USD a tasa de compra
      const u = await supabase.from('users').select('id').eq('tg_id', tg_id!).maybeSingle();
      await supabase.from('transactions').insert({
        user_id: u.data?.id,
        type: 'BUY',                 // negocio compra USD
        amount_currency: 'USD',
        amount_value: amount,
        rate_snapshot: r.buy_rate,
        method: 'bank',
        status: 'pending'
      });

      await tgSend(chatId, `Te pagaremos *${totalLocal.toFixed(2)}* en moneda local.\nElige método:`, {
        inline_keyboard: [
          [{ text: 'Transferencia bancaria', callback_data: 'METHOD:bank' }],
          [{ text: 'Zelle', callback_data: 'METHOD:zelle' }]
        ]
      });
      return NextResponse.json({ ok: true });
    }
  }

  // 3) CAPTURA (photo/document)
  const photo = update.message?.photo?.pop(); // última resolución
  const document = update.message?.document;  // pdf
  if ((photo || document) && chatId && tg_id) {
    const file_id = photo?.file_id ?? document?.file_id;
    try {
      const { buf, mime } = await tgGetFile(file_id);
      // buscar última tx pendiente sin recibo asignado
      const u = await supabase.from('users').select('id').eq('tg_id', tg_id).maybeSingle();
      const { data: tx } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', u.data?.id)
        .eq('status','pending')
        .order('created_at',{ ascending:false })
        .limit(1)
        .maybeSingle();
      if (!tx) {
        await tgSend(chatId, 'No encontré una transacción pendiente. Usa /comprar o /vender.');
        return NextResponse.json({ ok: true });
      }

      // Subir a Storage + insertar en receipts
      const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
      const path = `tx/${tx.id}/${Date.now()}.${ext}`;
      const supa = supabaseServer();
      const up = await supa.storage.from('receipts').upload(path, buf, { contentType: mime, upsert: false });
      if (up.error) throw up.error;
      await supa.from('receipts').insert({ transaction_id: tx.id, file_url: up.data.path });

      await tgSend(chatId, '✅ Recibimos tu captura. Pronto te confirmamos.');
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      console.error(e);
      await tgSend(chatId, '❌ Hubo un problema subiendo tu captura. Intenta de nuevo.');
      return NextResponse.json({ ok: false });
    }
  }

  return NextResponse.json({ ok: true });
}