// The household's currency (asked for 2026-11-25, for anyone using Ledger outside the United States).
//
// It only changes how amounts are WRITTEN: the symbol and the way numbers are grouped. Nothing is ever
// converted, and a household has one currency for everything. Amounts are still stored as plain numbers
// with two decimals.
//
//   setting `currency`          a three-letter code (USD unless chosen)
//   setting `currency_locale`   the language of the browser that chose it, so emails and PDFs group
//                               numbers the way that household reads them (en-US unless known)
//
// A US-dollar household gets exactly what it always got ("$1,234.56", "-$12.00").
import { getSetting } from './db.js';

export const CURRENCIES = [
  ['USD', 'US dollar'], ['CAD', 'Canadian dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'],
  ['AUD', 'Australian dollar'], ['NZD', 'New Zealand dollar'], ['CHF', 'Swiss franc'], ['SEK', 'Swedish krona'],
  ['NOK', 'Norwegian krone'], ['DKK', 'Danish krone'], ['PLN', 'Polish złoty'], ['CZK', 'Czech koruna'],
  ['JPY', 'Japanese yen'], ['INR', 'Indian rupee'], ['SGD', 'Singapore dollar'], ['HKD', 'Hong Kong dollar'],
  ['KRW', 'South Korean won'], ['PHP', 'Philippine peso'], ['ZAR', 'South African rand'], ['MXN', 'Mexican peso'],
  ['BRL', 'Brazilian real'], ['ILS', 'Israeli shekel'],
];
export const validCurrency = (c) => CURRENCIES.some(([code]) => code === c);
export const validLocale = (l) => { try { return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l) && Intl.NumberFormat.supportedLocalesOf([l]).length > 0; } catch { return false; } };

export const currency = () => { const c = getSetting('currency'); return validCurrency(c) ? c : 'USD'; };
const locale = () => { if (currency() === 'USD') return 'en-US'; const l = getSetting('currency_locale'); return validLocale(l) ? l : 'en-US'; };

const made = new Map();
function fmt(digits) {
  const key = currency() + '|' + locale() + '|' + digits;
  if (!made.has(key)) {
    const o = { style: 'currency', currency: currency(), currencyDisplay: 'narrowSymbol' };
    if (digits === 0) o.maximumFractionDigits = 0;
    made.set(key, new Intl.NumberFormat(locale(), o));
  }
  return made.get(key);
}
/** With the currency's usual decimals: $1,234.56 */
export const cents = (n) => fmt(2).format(Number(n) || 0);
/** Rounded to a whole unit: $1,235 */
export const whole = (n) => { const v = Number(n) || 0; return fmt(0).format(Math.sign(v) * Math.round(Math.abs(v))); };
export const currencyName = () => (CURRENCIES.find(([c]) => c === currency()) || CURRENCIES[0])[1];
export const symbol = () => fmt(0).formatToParts(0).find((p) => p.type === 'currency')?.value || '$';
/** A sentence for an AI prompt, so its answer is written in the household's money. Empty for US dollars. */
export const currencyNote = () => (currency() === 'USD' ? '' : 'All amounts in this household\'s data are in ' + currencyName() + ' (' + currency() + '). Write every amount with the symbol ' + symbol() + ', never as dollars, and do not convert anything.');
