// State income tax for every state and the District of Columbia, tax year 2026 (added 2026-11-23).
//
// Arkansas keeps its own, more careful engine in server/tax.js (its printed table, both ways of
// filing for a couple, the retirement exemption, the teacher deduction). Every other state is worked
// out here from one table: brackets or a flat rate, the standard deduction, and personal exemptions
// or credits, for a single filer and for a couple.
//
// SOURCE: the Tax Foundation's "State Individual Income Tax Rates and Brackets, as of January 1,
// 2026" (taxfoundation.org/data/all/state/state-income-tax-rates-2026/, page dated February 17,
// 2026), read on 2026-11-23 and transcribed as printed. It is a compilation, not each state's own
// form, and no figure here was checked against a state's own publication. A rate changed during
// 2026 is not reflected. In January these need the 2027 edition, like the federal constants.
//
// WHAT THE SIMPLE MODEL DOES: starts from federal adjusted gross income less any Social Security
// the federal return taxed; takes off the standard deduction and exemptions; applies the brackets;
// takes off credits. WHAT IT LEAVES OUT, for every state but Arkansas, and the page says so:
//  - city, county and school district income taxes (Ohio, Pennsylvania, Maryland, New York City,
//    Indiana, Kentucky, Michigan and others);
//  - each state's own credits, subtractions and additions, and how it treats pensions, retirement
//    withdrawals and Social Security (assumed: Social Security not taxed, the rest taxed in full);
//  - deductions that shrink as income rises (Alabama, Connecticut, Wisconsin and others), and
//    deducting federal tax (Alabama, Missouri, Oregon);
//  - itemizing on the state return, part-year residents, and income earned in another state;
//  - a head of household's own brackets: a single filer's are used, which can run a little high;
//  - married filing separately is figured on the couple's table;
//  - Washington's tax on large capital gains.
//
// Shape: b = brackets [rate in percent, income it starts at], s for single and j for a couple;
// std = standard deduction [single, couple]; ex = personal exemption [single, couple]; dep = per
// dependent. stdCredit / exCredit / depCredit mean the amount comes off the tax, not the income.

const flat = (rate, from = 0, fromJoint = from) => ({ s: [[rate, from]], j: [[rate, fromJoint]] });
const same = (rows) => ({ s: rows, j: rows });
const FED_STD = [16100, 32200];

export const STATES = {
  AL: { name: 'Alabama', b: { s: [[2, 0], [4, 500], [5, 3000]], j: [[2, 0], [4, 1000], [5, 6000]] }, std: [3000, 8500], ex: [1500, 3000], dep: 1000 },
  AK: { name: 'Alaska', none: true },
  AZ: { name: 'Arizona', b: flat(2.5), std: [8350, 16700], dep: 100, depCredit: true },
  AR: { name: 'Arkansas', own: true },
  CA: { name: 'California', b: { s: [[1, 0], [2, 11079], [4, 26264], [6, 41452], [8, 57542], [9.3, 72724], [10.3, 371479], [11.3, 445771], [12.3, 742953], [13.3, 1000000]], j: [[1, 0], [2, 22158], [4, 52528], [6, 82904], [8, 115084], [9.3, 145448], [10.3, 742958], [11.3, 891542], [12.3, 1000000], [13.3, 1485906]] }, std: [5540, 11080], ex: [153, 306], exCredit: true, dep: 153, depCredit: true },
  CO: { name: 'Colorado', b: flat(4.4), std: FED_STD },
  CT: { name: 'Connecticut', b: { s: [[2, 0], [4.5, 10000], [5.5, 50000], [6, 100000], [6.5, 200000], [6.9, 250000], [6.99, 500000]], j: [[2, 0], [4.5, 20000], [5.5, 100000], [6, 200000], [6.5, 400000], [6.9, 500000], [6.99, 1000000]] }, ex: [15000, 24000] },
  DE: { name: 'Delaware', b: same([[2.2, 2000], [3.9, 5000], [4.8, 10000], [5.2, 20000], [5.55, 25000], [6.6, 60000]]), std: [3250, 6500], ex: [110, 220], exCredit: true, dep: 110, depCredit: true },
  DC: { name: 'District of Columbia', b: same([[4, 0], [6, 10000], [6.5, 40000], [8.5, 60000], [9.25, 250000], [9.75, 500000], [10.75, 1000000]]), std: FED_STD },
  FL: { name: 'Florida', none: true },
  GA: { name: 'Georgia', b: flat(5.19), std: [12000, 24000], dep: 4000 },
  HI: { name: 'Hawaii', b: { s: [[1.4, 0], [3.2, 9600], [5.5, 14400], [6.4, 19200], [6.8, 24000], [7.2, 36000], [7.6, 48000], [7.9, 125000], [8.25, 175000], [9, 225000], [10, 275000], [11, 325000]], j: [[1.4, 0], [3.2, 19200], [5.5, 28800], [6.4, 38400], [6.8, 48000], [7.2, 72000], [7.6, 96000], [7.9, 250000], [8.25, 350000], [9, 450000], [10, 550000], [11, 650000]] }, std: [4400, 8800], ex: [1144, 2288], dep: 1144 },
  ID: { name: 'Idaho', b: flat(5.3, 4811, 9622), std: FED_STD },
  IL: { name: 'Illinois', b: flat(4.95), ex: [2925, 5850], dep: 2925 },
  IN: { name: 'Indiana', b: flat(2.95), ex: [1000, 2000], dep: 1000 },
  IA: { name: 'Iowa', b: flat(3.8), std: FED_STD, ex: [40, 80], exCredit: true, dep: 40, depCredit: true },
  KS: { name: 'Kansas', b: { s: [[5.2, 0], [5.58, 23000]], j: [[5.2, 0], [5.58, 46000]] }, std: [3605, 8240], ex: [9160, 18320], dep: 2320 },
  KY: { name: 'Kentucky', b: flat(3.5), std: [3360, 3360] },
  LA: { name: 'Louisiana', b: flat(3), std: [12875, 25750] },
  ME: { name: 'Maine', b: { s: [[5.8, 0], [6.75, 27399], [7.15, 64849]], j: [[5.8, 0], [6.75, 54849], [7.15, 129749]] }, std: [8350, 16700], ex: [5300, 10600], dep: 305, depCredit: true },
  MD: { name: 'Maryland', b: { s: [[2, 0], [3, 1000], [4, 2000], [4.75, 3000], [5, 100000], [5.25, 125000], [5.5, 150000], [5.75, 250000], [6.25, 500000], [6.5, 1000000]], j: [[2, 0], [3, 1000], [4, 2000], [4.75, 3000], [5, 150000], [5.25, 175000], [5.5, 225000], [5.75, 300000], [6.25, 600000], [6.5, 1200000]] }, std: [3350, 6700], ex: [3200, 6400], dep: 3200 },
  MA: { name: 'Massachusetts', b: same([[5, 0], [9, 1083150]]), ex: [4400, 8800], dep: 1000 },
  MI: { name: 'Michigan', b: flat(4.25), ex: [5900, 11800], dep: 5900 },
  MN: { name: 'Minnesota', b: { s: [[5.35, 0], [6.8, 33310], [7.85, 109430], [9.85, 203150]], j: [[5.35, 0], [6.8, 48700], [7.85, 193480], [9.85, 337930]] }, std: [15300, 30600], dep: 5300 },
  MS: { name: 'Mississippi', b: flat(4, 10000), std: [2300, 4600], ex: [6000, 12000], dep: 1500 },
  MO: { name: 'Missouri', b: same([[2, 1348], [2.5, 2696], [3, 4044], [3.5, 5392], [4, 6740], [4.5, 8088], [4.7, 9436]]), std: FED_STD },
  MT: { name: 'Montana', b: { s: [[4.7, 0], [5.65, 47500]], j: [[4.7, 0], [5.65, 95000]] }, std: FED_STD },
  NE: { name: 'Nebraska', b: { s: [[2.46, 0], [3.51, 4130], [4.55, 24760]], j: [[2.46, 0], [3.51, 8250], [4.55, 49530]] }, std: [8850, 17700], ex: [176, 352], exCredit: true, dep: 176, depCredit: true },
  NV: { name: 'Nevada', none: true },
  NH: { name: 'New Hampshire', none: true },
  NJ: { name: 'New Jersey', b: { s: [[1.4, 0], [1.75, 20000], [3.5, 35000], [5.53, 40000], [6.37, 75000], [8.97, 500000], [10.75, 1000000]], j: [[1.4, 0], [1.75, 20000], [2.45, 50000], [3.5, 70000], [5.53, 80000], [6.37, 150000], [8.97, 500000], [10.75, 1000000]] }, ex: [1000, 2000], dep: 1500 },
  NM: { name: 'New Mexico', b: { s: [[1.5, 0], [3.2, 5500], [4.3, 16500], [4.7, 33500], [4.9, 66500], [5.9, 210000]], j: [[1.5, 0], [3.2, 8000], [4.3, 25000], [4.7, 50000], [4.9, 100000], [5.9, 315000]] }, std: FED_STD, dep: 4000 },
  NY: { name: 'New York', b: { s: [[3.9, 0], [4.4, 8500], [5.15, 11700], [5.4, 13900], [5.9, 80650], [6.85, 215400], [9.65, 1077550], [10.3, 5000000], [10.9, 25000000]], j: [[3.9, 0], [4.4, 17150], [5.15, 23600], [5.4, 27900], [5.9, 161550], [6.85, 323200], [9.65, 2155350], [10.3, 5000000], [10.9, 25000000]] }, std: [8000, 16050], dep: 1000 },
  NC: { name: 'North Carolina', b: flat(3.99), std: [12750, 25500] },
  ND: { name: 'North Dakota', b: { s: [[1.95, 48475], [2.5, 244825]], j: [[1.95, 80975], [2.5, 298075]] }, std: FED_STD },
  OH: { name: 'Ohio', b: flat(2.75, 26050), ex: [2400, 4800], dep: 2400 },
  OK: { name: 'Oklahoma', b: { s: [[2.5, 3750], [3.5, 4900], [4.5, 7200]], j: [[2.5, 7500], [3.5, 9800], [4.5, 14400]] }, std: [6350, 12700], ex: [1000, 2000], dep: 1000 },
  OR: { name: 'Oregon', b: { s: [[4.75, 0], [6.75, 4550], [8.75, 11400], [9.9, 125000]], j: [[4.75, 0], [6.75, 9100], [8.75, 22800], [9.9, 250000]] }, std: [2910, 5820], ex: [256, 512], exCredit: true, dep: 256, depCredit: true },
  PA: { name: 'Pennsylvania', b: flat(3.07) },
  RI: { name: 'Rhode Island', b: same([[3.75, 0], [4.75, 82050], [5.99, 186450]]), std: [11200, 22400], ex: [5250, 10500], dep: 5250 },
  SC: { name: 'South Carolina', b: same([[0, 0], [3, 3640], [6, 18230]]), std: [8350, 16700], dep: 4930 },
  SD: { name: 'South Dakota', none: true },
  TN: { name: 'Tennessee', none: true },
  TX: { name: 'Texas', none: true },
  UT: { name: 'Utah', b: flat(4.5), std: [966, 1932], stdCredit: true, dep: 2111 },
  VT: { name: 'Vermont', b: { s: [[3.35, 0], [6.6, 49400], [7.6, 119700], [8.75, 249700]], j: [[3.35, 0], [6.6, 82500], [7.6, 199450], [8.75, 304000]] }, std: [7650, 15300], ex: [5300, 10600], dep: 5300 },
  VA: { name: 'Virginia', b: same([[2, 0], [3, 3000], [5, 5000], [5.75, 17000]]), std: [8750, 17500], ex: [930, 1860], dep: 930 },
  WA: { name: 'Washington', none: true },
  WV: { name: 'West Virginia', b: same([[2.22, 0], [2.96, 10000], [3.33, 25000], [4.44, 40000], [4.82, 60000]]), ex: [2000, 4000], dep: 2000 },
  WI: { name: 'Wisconsin', b: { s: [[3.5, 0], [4.4, 15110], [5.3, 51950], [7.65, 332720]], j: [[3.5, 0], [4.4, 20150], [5.3, 69260], [7.65, 443630]] }, std: [13960, 25840], ex: [700, 1400], dep: 700 },
  WY: { name: 'Wyoming', none: true },
};

// No state is assumed (2026-11-24, the owner: "I'd prefer for it not to assume any state at all"). Until a
// household chooses one the setting is empty, which is NO_STATE here: no state tax is worked out, and the
// Taxes page shows nothing but the menu to choose from.
export const NO_STATE = '--';
STATES[NO_STATE] = { name: 'No state chosen yet', none: true, unset: true };
export const stateOf = (v) => { const c = String(v || '').toUpperCase(); return c !== NO_STATE && Object.hasOwn(STATES, c) ? c : NO_STATE; };
export const stateChosen = (v) => stateOf(v) !== NO_STATE;
/** For the menu: every state by name. */
export const stateList = () => Object.entries(STATES).filter(([, s]) => !s.unset).map(([code, s]) => ({ code, name: s.name, none: !!s.none })).sort((a, b) => a.name.localeCompare(b.name));

/** Tax on `taxable` from a list of [rate in percent, starts at]. Income under the first start is not taxed. */
export function bracketTax(taxable, rows) {
  let tax = 0, rate = 0;
  for (let i = 0; i < rows.length; i++) {
    const [r, from] = rows[i], to = i + 1 < rows.length ? rows[i + 1][1] : Infinity;
    if (taxable > from) { tax += (Math.min(taxable, to) - from) * (r / 100); rate = r / 100; }
  }
  return { tax, rate };
}

/**
 * A state's income tax by the simple model above. `income` is federal adjusted gross income less the
 * Social Security the federal return taxed; `two` is a married couple; `dependents` a count.
 */
export function simpleStateTax(code, { income, two, dependents }) {
  const S = STATES[code];
  if (!S || S.none || S.own) return { tax: 0, taxable: 0, rate: 0 };
  const i = two ? 1 : 0;
  const std = S.std ? S.std[i] : 0, ex = S.ex ? S.ex[i] : 0, dep = (S.dep || 0) * Math.max(0, dependents || 0);
  const taxable = Math.max(0, income - (S.stdCredit ? 0 : std) - (S.exCredit ? 0 : ex) - (S.depCredit ? 0 : dep));
  const { tax, rate } = bracketTax(taxable, two ? S.b.j : S.b.s);
  const credits = (S.stdCredit ? std : 0) + (S.exCredit ? ex : 0) + (S.depCredit ? dep : 0);
  return { tax: Math.max(0, tax - credits), taxable, rate };
}

/** What the pages show about the chosen state. */
export function stateInfo(code) {
  const S = STATES[code];
  return {
    code, name: S.name, none: !!S.none, unset: !!S.unset, detailed: !!S.own,
    topRate: S.b ? Math.max(...S.b.s.map(([r]) => r)) : S.own ? 3.7 : 0,
    flat: !!S.b && S.b.s.length === 1,
    source: S.own ? "Arkansas's own 2026 estimated tax worksheet" : S.none ? '' : "the Tax Foundation's table of state rates as of January 1, 2026",
  };
}
