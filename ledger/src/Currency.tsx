// Choosing the household's currency (server/money.js): Settings, "Currency", and the setup guide's first
// step. It changes how every amount is written, on every device, in emails and in what the AI is told.
// Nothing is converted.
import { useState } from 'react';
import { api, forgetLoaded, setCurrency, useData } from './lib';

export function CurrencyPick({ reload = false, label = 'Currency' }: { reload?: boolean; label?: string }) {
  const { data, reload: again } = useData<{ currency: string; list: { code: string; name: string }[] }>('/api/currencies');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!data) return null;
  const pick = async (code: string) => {
    setBusy(true); setErr('');
    try {
      await api('/api/settings', { method: 'PUT', body: { currency: code, currency_locale: navigator.language || '' } });
      setCurrency(code);
      forgetLoaded();
      // Every figure on screen was drawn in the old currency: the page is drawn again from scratch.
      if (reload) { location.reload(); return; }
      again();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <>
      <label className="field currency-pick" data-go="currency"><span>{label}</span>
        <select value={data.currency} disabled={busy} onChange={(e) => pick(e.target.value)}>
          {data.list.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select>
      </label>
      {err && <p className="error" role="alert">{err}</p>}
    </>
  );
}

export function CurrencySettings() {
  return (
    <section className="card">
      <p className="sub first">The money your household uses. Every amount in Ledger is written with its symbol, here, in the summary email and in what the AI features are told.</p>
      <CurrencyPick reload />
      <p className="sub">This changes how amounts are written and nothing else: figures are never converted, and everything in a household is in one currency. Amounts are typed with a point for the decimals, such as 12.50. Bank sync through SimpleFIN covers banks in the United States and Canada; elsewhere, add purchases by hand, from a receipt, or from a bank's file. The tax estimate covers the United States only.</p>
    </section>
  );
}
