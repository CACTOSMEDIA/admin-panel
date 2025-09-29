import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = supabaseServer();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit' });
    const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
    const startUTC = new Date(Date.UTC(y, m-1, d, 0, 0, 0)).toISOString();
    const endUTC   = new Date(Date.UTC(y, m-1, d+1, 0, 0, 0)).toISOString();

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id,type,amount_value,created_at')
      .gte('created_at', startUTC)
      .lt('created_at', endUTC);

    if (error) return NextResponse.json({ ok:false, error: error.message }, { status: 500 });

    let compras = 0, ventas = 0;
    for (const t of txs ?? []) {
      if (t.type === 'BUY')  compras += Number(t.amount_value);
      if (t.type === 'SELL') ventas  += Number(t.amount_value);
    }
    const n = txs?.length ?? 0;
    const gananciaAprox = ventas - compras;

    const text =
`🧾 *Cierre diario* (hora Bogotá)
Transacciones: ${n}
Inversión (compras): ${compras.toLocaleString('en-US')}
Ventas: ${ventas.toLocaleString('en-US')}
Ganancia aprox.: ${gananciaAprox.toLocaleString('en-US')}

Rango: ${startUTC} → ${endUTC} (UTC)`;

    const tgRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID, text, parse_mode: 'Markdown' })
    });

    if (!tgRes.ok) {
      const body = await tgRes.text();
      return NextResponse.json({ ok:false, tgError: body }, { status: 500 });
    }

    return NextResponse.json({ ok:true, n, compras, ventas, gananciaAprox });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok:false, error: msg }, { status: 500 });
  }
}
