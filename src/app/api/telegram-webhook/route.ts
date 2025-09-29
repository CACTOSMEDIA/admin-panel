import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic'; // ✅ string, no función
export const runtime = 'nodejs';        // ✅ string, no función

// Helpers Telegram
async function tgSend(chat_id: number | string, text: string, markup?: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'Markdown', reply_markup: markup })
  });
  if (!res.ok) console.error('tgSend fail', await res.text());
}

async function tgGetFile(file_id: string) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${file_id}`);
  const j: { ok: boolean; result?: { file_path: string } } = await r.json();
  if (!j.ok || !j.result) throw new Error('getFile failed');
  const path = j.result.file_path;
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`;
  const fileRes = await fetch(url);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const mime =
    path.endsWith('.pdf') ? 'application/pdf' :
    path.endsWith('.png') ? 'image/png' :
    'image/jpeg';
  return { buf, mime };
}

// DB utils
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

function bogotaDayRangeUTC(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit' });
  const [y, m, d] = fmt.format(now).split('-').map(Number);
  const startUTC = new Date(Date.UTC(y, m-1, d, 0, 0, 0)).toISOString();
  const endUTC   = new Date(Date.UTC(y, m-1, d+1, 0, 0, 0)).toISOString();
  return { startUTC, endUTC };
}

export async function POST(req: NextRequest) {
  const update = await req.json();
  const supabase = supabaseServer();

  const msg = update.message ?? update.edited_message ?? update.callback_query?.message;
  const chatId: number | undefined = msg?.chat?.id;
  const from = update.message?.from ?? update.callback_query?.from;
  const tg_id = from?.id as number | undefined;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Usuario';

  if (tg_id) {
    await supabase.from('users').upsert({ tg_id, name, role: 'client' }, { onConflict: 'tg_id' });
  }

  // CALLBACKS
  if (update.callback_query) {
    const data: string = update.callback_query.data;

    if (data.startsWith('METHOD:')) {
      const method = data.split(':')[1]; // bank|zelle
      const { data: accs } = await supabase.from('receive_accounts')
        .select('id,label,bank_name,account_number,zelle_user,zelle_holder,currency,active')
        .eq('active', true);

      if (!accs || accs.length === 0) {
        if (chatId) await tgSend(chatId, 'No hay cuentas disponibles. Contacta soporte.');
        return NextResponse.json({ ok: true });
      }
      const keyboard = accs.map(a => [{ text: a.label ?? a.bank_name ?? 'Cuenta', callback_data: `RCV:${a.id}:${method}` }]);
      if (chatId) await tgSend(chatId, 'Elige la cuenta destino para tu pago:', { inline_keyboard: keyboard });
      return NextResponse.json({ ok: true });
    }

    if (data.startsWith('RCV:')) {
      const [, accId, method] = data.split(':');
      const userRow = await supabase.from('users').select('id').eq('tg_id', tg_id!).maybeSingle();
      const { data: lastTx } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', userRow.data?.id)
        .eq('status','pending')
        .is('target_receive_account', null)
        .order('created_at', { ascending:false })
        .limit(1)
        .maybeSingle();

      if (!lastTx) {
        if (chatId) await tgSend(chatId, 'No encontré una transacción pendiente. Inicia con /comprar o /vender.');
        return NextResponse.json({ ok: true });
      }

      await supabase.from('transactions')
        .update({ method, target_receive_account: accId })
        .eq('id', lastTx.id);

      const { data: acc } = await supabase.from('receive_accounts').select('*').eq('id', accId).maybeSingle();
      const detail =
        method === 'zelle'
          ? `Paga por *Zelle*\nUsuario: \`${acc?.zelle_user ?? '—'}\`\nTitular: *${acc?.zelle_holder ?? '—'}*\nMoneda: ${acc?.currency}`
          : `Transferencia bancaria\nBanco: *${acc?.bank_name ?? '—'}*\nCuenta: \`${acc?.account_number ?? '—'}\`\nMoneda: ${acc?.currency}`;

      if (chatId) await tgSend(chatId, `${detail}\n\n*Sube tu captura de pago* (foto o PDF) en este chat.`);
      return NextResponse.json({ ok: true });
    }
  }

  // COMANDOS
  const text: string | undefined = update.message?.text;
  if (text && chatId) {
    if (text.startsWith('/start')) {
      const welcome =
`👋 *¡Bienvenido a tu Bot de Tasas!*

Con este bot podrás:
💱 Consultar tasas de compra y venta
📊 Ver el cierre diario
⚙️ Fijar tus propias tasas de referencia

*Comandos disponibles:*
/tasas - Ver tasas actuales
/cierre - Ver cierre diario
/set_compra - Fijar tasa de compra
/set_venta - Fijar tasa de venta
/help - Mostrar ayuda

✨ Usa los comandos desde el menú o escríbelos directamente.`;
      await tgSend(chatId, welcome);
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/help')) {
      const help =
`👋 *Ayuda*

/tasas - Ver tasas actuales
/cierre - Ver cierre diario
/set_compra - Fijar tasa de compra (admin)
/set_venta - Fijar tasa de venta (admin)

✨ Usa los comandos desde el menú o escríbelos directamente.`;
      await tgSend(chatId, help);
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/cierre')) {
      const { startUTC, endUTC } = bogotaDayRangeUTC(new Date());
      const { data: txs, error } = await supabase
        .from('transactions')
        .select('type,amount_value')
        .gte('created_at', startUTC)
        .lt('created_at',  endUTC);

      if (error) {
        await tgSend(chatId, 'No pude calcular el cierre. Intenta de nuevo.');
        return NextResponse.json({ ok: true });
      }

      let compras = 0, ventas = 0;
      for (const t of txs ?? []) {
        if (t.type === 'BUY')  compras += Number(t.amount_value);
        if (t.type === 'SELL') ventas  += Number(t.amount_value);
      }
      const n = txs?.length ?? 0;
      const gan = ventas - compras;

      const textResp =
`🧾 *Cierre diario* (hora Bogotá)
Transacciones: ${n}
Inversión (compras): ${compras.toLocaleString('en-US')}
Ventas: ${ventas.toLocaleString('en-US')}
Ganancia aprox.: ${gan.toLocaleString('en-US')}

Rango: ${startUTC} → ${endUTC} (UTC)`;
      await tgSend(chatId, textResp);
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/tasas')) {
      const r = await getCurrentRates(supabase);
      await tgSend(chatId, r ? `Tasas actuales:\nCompra: *${r.buy_rate}*\nVenta: *${r.sell_rate}*` : 'Aún no hay tasas activas. (Admin: usa /set_compra y /set_venta)');
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/set_compra')) {
      const isAdmin = (await supabase.from('users').select('role').eq('tg_id', tg_id!).maybeSingle()).data?.role === 'admin';
      if (!isAdmin) { await tgSend(chatId, 'Solo admin.'); return NextResponse.json({ ok: true }); }
      const val = Number(text.split(' ')[1]);
      if (!val) { await tgSend(chatId, 'Uso: /set_compra 36.15'); return NextResponse.json({ ok: true }); }
      const cur = await getCurrentRates(supabase);
      await supabase.from('rates').update({ valid_to: new Date().toISOString() }).is('valid_to', null);
      await supabase.from('rates').insert({ buy_rate: val, sell_rate: cur?.sell_rate ?? val + 0.5 });
      await tgSend(chatId, `OK. Tasa de *compra* actualizada a ${val}.`);
      return NextResponse.json({ ok: true });
    }

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

    if (text.startsWith('/comprar')) {
      const amount = Number(text.split(' ')[1]);
      const r = await getCurrentRates(supabase);
      if (!r || !amount) { await tgSend(chatId, 'Uso: /comprar 100'); return NextResponse.json({ ok: true }); }
      const totalLocal = amount * Number(r.sell_rate);
      const u = await supabase.from('users').select('id').eq('tg_id', tg_id!).maybeSingle();
      await supabase.from('transactions').insert({
        user_id: u.data?.id,
        type: 'SELL', // negocio vende USD
        amount_currency: 'USD',
        amount_value: amount,
        rate_snapshot: r.sell_rate,
        method: 'bank',
        status: 'pending'
      });
      await tgSend(chatId, `Total a pagar en moneda local: *${totalLocal.toFixed(2)}*.\nElige método:`, {
        inline_keyboard: [
          [{ text: 'Transferencia bancaria', callback_data: 'METHOD:bank' }],
          [{ text: 'Zelle', callback_data: 'METHOD:zelle' }]
        ]
      });
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/vender')) {
      const amount = Number(text.split(' ')[1]);
      const r = await getCurrentRates(supabase);
      if (!r || !amount) { await tgSend(chatId, 'Uso: /vender 120'); return NextResponse.json({ ok: true }); }
      const totalLocal = amount * Number(r.buy_rate);
      const u = await supabase.from('users').select('id').eq('tg_id', tg_id!).maybeSingle();
      await supabase.from('transactions').insert({
        user_id: u.data?.id,
        type: 'BUY', // negocio compra USD
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

  // CAPTURA
  const photo = update.message?.photo?.pop();
  const document = update.message?.document;
  if ((photo || document) && chatId && tg_id) {
    const file_id = photo?.file_id ?? document?.file_id;
    try {
      const { buf, mime } = await tgGetFile(file_id);
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

      const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
      const path = `tx/${tx.id}/${Date.now()}.${ext}`;
      const supa = supabaseServer();
      const up = await supa.storage.from('receipts').upload(path, buf, { contentType: mime, upsert: false });
      if (up.error) throw up.error;
      await supa.from('receipts').insert({ transaction_id: tx.id, file_url: up.data.path });

      await tgSend(chatId, '✅ Recibimos tu captura. Pronto te confirmamos.');
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      await tgSend(chatId!, '❌ Hubo un problema subiendo tu captura. Intenta de nuevo.');
      return NextResponse.json({ ok: false });
    }
  }

  return NextResponse.json({ ok: true });
}
