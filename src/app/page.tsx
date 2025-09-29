export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Panel Admin — FX</h1>
      <p className="mt-2 text-sm opacity-70">
        Next.js + Supabase listo para conectar.
      </p>

      <div className="mt-6 text-sm">
        <ul className="list-disc pl-4 space-y-1">
          <li>Webhook del bot: <code>/api/telegram-webhook</code></li>
          <li>Cierre diario (cron): <code>/api/cierre-diario</code></li>
        </ul>
      </div>
    </main>
  );
}
