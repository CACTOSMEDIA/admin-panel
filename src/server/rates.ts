import { supabaseServer } from '@/lib/supabaseServer';

export async function setRates(buy: number, sell: number) {
  const supabase = supabaseServer();
  await supabase.from('rates').update({ valid_to: new Date().toISOString() }).is('valid_to', null);
  const { error } = await supabase.from('rates').insert({ buy_rate: buy, sell_rate: sell });
  if (error) throw error;
}

export async function getCurrentRates() {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from('rates')
    .select('buy_rate,sell_rate')
    .is('valid_to', null)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data; // { buy_rate, sell_rate } | null
}
