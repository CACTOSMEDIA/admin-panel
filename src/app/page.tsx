'use client';

import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Button } from "@/components/ui/Button";

export default function Home() {
  return (
    <main className="p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Panel Admin — FX</h1>
      <p className="text-sm opacity-70">Next.js + Supabase listo para conectar.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><Stat label="Inversión (hoy)" value="$0" hint="Compras del día" /></Card>
        <Card><Stat label="Ventas (hoy)" value="$0" hint="Ventas del día" /></Card>
        <Card><Stat label="Ganancia (hoy)" value="$0" hint="Estimado simple" /></Card>
      </div>

      <div className="flex gap-3">
        <Button onClick={() => alert('Pronto: /set_compra /set_venta')}>Configurar tasas</Button>
        <Button variant="outline" onClick={() => alert('Pronto: export CSV')}>Exportar CSV</Button>
      </div>
    </main>
  );
}
