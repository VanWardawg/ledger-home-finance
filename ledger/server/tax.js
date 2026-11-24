// Tax estimate for a household, tax year 2026: wages from any number of jobs, self-employment from
// any number of side gigs, retirement income (Social Security, pensions, IRA withdrawals),
// unemployment, interest, dividends, long-term gains and rental profit; the family credits (child,
// other dependents, earned income, child care, college), student loan interest, itemizing, the
// age-65 deductions and marketplace health insurance. Filing status is 'joint', 'single', 'hoh'
// (head of household) or 'separate' (married filing separately: each spouse's federal tax is
// worked out alone and added). An estimate only; what it leaves out is listed in CLAUDE.md.
//
// Rewritten 2026-11-18 (the version before is .claude/snapshots/tax-before-2026-11-18.js). With
// none of the newer inputs it gives the figures the old one did.
//
// Sources:
//  - Federal brackets and standard deduction, all three statuses: IRS Rev. Proc. 2025-32
//    (checked against the Tax Foundation's 2026 table on 2026-11-17).
//  - Arkansas personal credits: $29 each; two for a joint return or a head of household.
//  - Arkansas: AR1000ES 2026 worksheet (revised 5/6/2026, top rate 3.7%).
//  - Read from Rev. Proc. 2025-32 itself on 2026-11-18: earned income credit table and its $12,200
//    investment-income limit; child tax credit $2,200 with $1,700 refundable; $1,650 / $2,050 extra
//    standard deduction at 65; student loan interest phase-out ($85,000-$100,000, joint
//    $175,000-$205,000); married-filing-separately standard deduction $16,100.
//  - From secondary sources that agreed with each other (not read in the law): the $6,000 senior
//    deduction (2025-2028, less 6% of income over $75,000 / $150,000, joint return required if
//    married); the child care credit's 50% top rate from 2026; long-term gains thresholds
//    ($49,450 / $66,200 / $98,900); the $40,400 cap on state and local taxes; the 0.5% floor on
//    itemized giving and the $1,000 / $2,000 deduction for giving without itemizing.
//  - From memory, NOT checked on 2026-11-18, so the first things to verify: the marketplace
//    insurance percentages (2.10% to 9.96%) and poverty line ($15,650 plus $5,500 a person); the
//    college credits; Social Security's $25,000 / $32,000 / $34,000 / $44,000 thresholds.
//  - Arkansas, from the 2025 AR1000F instructions (2026's weren't out): Social Security exempt;
//    unemployment taxed; the first $6,000 each of employer pensions and of IRA withdrawals after
//    59 1/2 exempt; an extra $29 credit at 65, and another for a 65-year-old not using the
//    retirement exemption; student loan interest allowed; half of self-employment tax is not in
//    its list of adjustments (which settles the old open question). Not modelled for Arkansas:
//    its low-income tables, the $60 credit for incomes under about $27,600, its child care
//    credit, any break on capital gains, and itemizing differences (it reuses the federal items
//    without state income tax).

import { STATES, simpleStateTax, stateInfo, stateOf } from './states.js';

export const TAX_YEAR = 2026;

const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
const table = (tops) => [...tops, Infinity].map((top, i) => [top, RATES[i]]);
const BY_STATUS = {
  joint: { standardDeduction: 32200, brackets: table([24800, 100800, 211400, 403550, 512450, 768700]) },
  single: { standardDeduction: 16100, brackets: table([12400, 50400, 105700, 201775, 256225, 640600]) },
  hoh: { standardDeduction: 24150, brackets: table([17700, 67450, 105700, 201750, 256200, 640600]) },
  // Married filing separately: half the joint table.
  separate: { standardDeduction: 16100, brackets: table([12400, 50400, 105700, 201775, 256225, 384350]) },
};
export const statusOf = (v) => (['single', 'hoh', 'separate'].includes(v) ? v : 'joint');
const FED = {
  socialSecurityWageBase: 184500,
  childTaxCredit: 2200, childRefundable: 1700, otherDependent: 500,
  // Earned income credit, by number of children (0 to 3): income where it tops out, the most it
  // pays, where it starts to shrink and where it is gone (joint, then everyone else), and the rates.
  eitc: {
    earned: [8680, 13020, 18290, 18290], max: [664, 4427, 7316, 8231],
    startJoint: [18140, 31160, 31160, 31160], endJoint: [26820, 58863, 65899, 70244],
    start: [10860, 23890, 23890, 23890], end: [19540, 51593, 58629, 62974],
    investmentLimit: 12200,
  },
  extra65: { married: 1650, unmarried: 2050 },
  senior: { each: 6000, rate: 0.06, from: { joint: 150000, other: 75000 } },
  socialSecurity: { joint: [32000, 44000], other: [25000, 34000], separate: [0, 0] },
  studentLoan: { max: 2500, joint: [175000, 205000], other: [85000, 100000] },
  gains: { joint: [98900, 613700], hoh: [66200, 579600], single: [49450, 545500], separate: [49450, 306850] },
  saltCap: { separate: 20200, other: 40400 }, medicalFloor: 0.075, givingFloor: 0.005, givingPlain: { joint: 2000, other: 1000 },
  care: { one: 3000, more: 6000 },
  college: { joint: [160000, 180000], other: [80000, 90000] },
  market: { poverty: 15650, perPerson: 5500, steps: [[1.33, 0.021, 0.021], [1.5, 0.0314, 0.0419], [2, 0.0419, 0.066], [2.5, 0.066, 0.0844], [3, 0.0844, 0.0996], [4, 0.0996, 0.0996]] },
};

const AR = {
  retirementExempt: 6000, // per person: employer pensions, and IRA withdrawals after 59 1/2
  standardDeduction: 2470, // per taxpayer
  personalCredit: 29, // per taxpayer and per dependent
  // [income from, tax at that point, rate on the excess]
  rows: [[5600, 0, 0.02], [11200, 111, 0.03], [16000, 255, 0.034], [26400, 608, 0.037], [30000, 741, 0.037],
    [40000, 1111, 0.037], [50000, 1481, 0.037], [60000, 1851, 0.037], [70000, 2221, 0.037], [80001, 2591, 0.037]],
};

const round = (n) => Math.round(n);

function federalBracketTax(taxable, brackets) {
  let tax = 0, floor = 0, rate = 0.1;
  for (const [top, r] of brackets) {
    if (taxable > floor) { tax += (Math.min(taxable, top) - floor) * r; rate = r; }
    floor = top;
  }
  const idx = brackets.findIndex(([top]) => taxable <= top);
  return { tax, rate, bracketTop: brackets[idx][0], bracketFloor: idx ? brackets[idx - 1][0] : 0 };
}

export function arkansasTax(net) {
  if (net < 5600) return 0;
  if (net >= 100000) return 3618 + 0.037 * (net - 99999.99);
  if (net >= 97601) return 3533 + 0.037 * (net - 97600.99);
  // Between these points the state prints a $100-step table; this follows its slope.
  if (net >= 94701) return 3136 + Math.floor((net - 94701) / 100) * 13.69;
  const row = [...AR.rows].reverse().find(([from]) => net >= from);
  return row[1] + row[2] * (net - row[0]);
}

/** One full scenario. seNet is self-employment profit (income minus expenses). */
// Classroom expenses for K-12 teachers. Federal: $350 per educator comes off
// income directly, and from 2026 anything above that can be itemized.
// Arkansas has its own deduction, $1,000 per teacher (2025 form AR1000CE).
const EDUCATOR = { federalCap: 350, arkansasCap: 1000 };

export function educatorSplit(teaching, educators) {
  const fedAboveLine = Math.min(teaching, EDUCATOR.federalCap * educators);
  return {
    total: round(teaching), fedAboveLine: round(fedAboveLine), fedCap: EDUCATOR.federalCap * educators,
    fedExcess: round(educators ? teaching - fedAboveLine : 0),
    arDeduction: round(Math.min(teaching, EDUCATOR.arkansasCap * educators)), arCap: EDUCATOR.arkansasCap * educators,
  };
}

const n0 = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * One federal return. `u` is a "unit": the whole household for a joint, single or head-of-household
 * return, or one spouse for married filing separately.
 *   people: [{ wages (after pre-tax deductions), se (self-employment profit), over65 }]
 *   ss, pensions (taxable part of pensions and retirement withdrawals), unemployment, interest,
 *   dividends (qualified), gains (long-term, may be negative), rental, other
 *   ctcKids, otherDeps, eitcKids, careKids, careCost, collegeStudents, collegeCost
 *   adjustments, studentLoan, itemized (a lump), mortgage, propertyTax, stateTax, giving, medical
 *   market: { benchmark, advance, people } (yearly amounts), eduAbove, eduExcess, mustItemize
 */
function federal(u, status) {
  const F = BY_STATUS[status], joint = status === 'joint', sep = status === 'separate';
  const people = u.people;
  const wages = people.reduce((a, p) => a + p.wages, 0);
  // Self-employment tax: 15.3% on 92.35% of each person's profit; none is due under $400.
  let seTax = 0;
  for (const p of people) {
    const base = p.se >= 400 ? p.se * 0.9235 : 0;
    seTax += 0.124 * Math.min(base, Math.max(0, FED.socialSecurityWageBase - p.wages)) + 0.029 * base;
  }
  const seNet = people.reduce((a, p) => a + p.se, 0);
  const halfSe = seTax / 2;
  // Long-term gains and qualified dividends get their own, lower rates; a loss comes off other income up to $3,000.
  const lowRate = Math.max(0, u.dividends + Math.max(0, u.gains));
  const loss = u.gains < 0 ? Math.max(u.gains, sep ? -1500 : -3000) : 0;
  const ordinaryOther = u.unemployment + u.interest + u.pensions + u.rental + u.other + loss;
  // Adjustments (IRA, HSA) come off income directly.
  const before = wages + seNet - halfSe + ordinaryOther + lowRate - u.adjustments - u.eduAbove;
  // Social Security: none, half or up to 85% of it is taxed, by how much other income there is.
  const [ss1, ss2] = FED.socialSecurity[joint ? 'joint' : sep ? 'separate' : 'other'];
  const provisional = Math.max(0, before) + u.ss / 2;
  const ssTaxed = u.ss > 0 ? Math.min(0.85 * u.ss, 0.85 * Math.max(0, provisional - ss2) + Math.min(0.5 * u.ss, 0.5 * Math.min(Math.max(0, provisional - ss1), ss2 - ss1))) : 0;
  const magi = Math.max(0, before + ssTaxed);
  const [sl1, sl2] = FED.studentLoan[joint ? 'joint' : 'other'];
  const studentLoan = sep ? 0 : Math.min(FED.studentLoan.max, u.studentLoan) * (1 - clamp01((magi - sl1) / (sl2 - sl1)));
  const agi = Math.max(0, magi - studentLoan);

  // Deductions: the standard one (larger from 65), or itemized if that comes to more.
  const n65 = people.filter((p) => p.over65).length;
  const standard = F.standardDeduction + n65 * (joint || sep ? FED.extra65.married : FED.extra65.unmarried);
  const salt = Math.min(FED.saltCap[sep ? 'separate' : 'other'], u.propertyTax + u.stateTax);
  const medical = Math.max(0, u.medical - FED.medicalFloor * agi);
  const giving = Math.max(0, u.giving - FED.givingFloor * agi);
  const itemizedTotal = u.itemized + u.eduExcess + u.mortgage + salt + medical + giving;
  const itemizing = u.mustItemize || itemizedTotal > standard;
  const fedDeduction = itemizing ? itemizedTotal : standard;
  const givingPlain = itemizing ? 0 : Math.min(u.giving, FED.givingPlain[joint ? 'joint' : 'other']);
  // The extra $6,000 for each person 65 or older, on top of either kind of deduction.
  const senior = sep ? 0 : Math.max(0, n65 * FED.senior.each - FED.senior.rate * Math.max(0, agi - FED.senior.from[joint ? 'joint' : 'other']));
  const beforeQbi = Math.max(0, agi - fedDeduction - givingPlain - senior);
  // Qualified business income deduction: 20% of profit, capped by taxable income (less the low-rate part).
  const qbi = Math.max(0, Math.min(0.2 * (seNet - halfSe), 0.2 * Math.max(0, beforeQbi - lowRate)));
  const taxable = beforeQbi - qbi;
  const lowTaxable = Math.min(lowRate, taxable), ordinary = taxable - lowTaxable;
  const fed = federalBracketTax(ordinary, F.brackets);
  const [g0, g15] = FED.gains[status];
  const at15 = Math.max(0, Math.min(taxable, g15) - Math.max(ordinary, g0)), at20 = Math.max(0, taxable - Math.max(ordinary, g15));
  const gainsTax = 0.15 * at15 + 0.2 * at20;
  const taxBefore = fed.tax + gainsTax;

  // Credits that can only bring the tax down to zero, in the order the return takes them.
  const earnedOf = (p) => Math.max(0, p.wages + p.se - (p.se >= 400 ? 0.5 * (0.124 * Math.min(p.se * 0.9235, Math.max(0, FED.socialSecurityWageBase - p.wages)) + 0.029 * p.se * 0.9235) : 0));
  const earned = people.reduce((a, p) => a + earnedOf(p), 0);
  let left = taxBefore;
  const take = (amount) => { const used = Math.min(left, Math.max(0, amount)); left -= used; return used; };
  // Child care: a share of up to $3,000 of costs for one child under 13, $6,000 for more, from 50% down to 20% as income rises.
  let careRate = 0.5 - 0.01 * Math.ceil(Math.max(0, agi - 15000) / 2000);
  careRate = Math.max(0.35, careRate);
  const careTop = joint ? 150000 : 75000;
  if (agi > careTop) careRate = Math.max(0.2, 0.35 - 0.01 * Math.ceil((agi - careTop) / (joint ? 4000 : 2000)));
  const careBase = sep || !u.careKids ? 0 : Math.min(u.careCost, u.careKids > 1 ? FED.care.more : FED.care.one, ...people.map(earnedOf));
  const care = take(careBase * careRate);
  // College (the American opportunity credit): up to $2,500 a student, 40% of it paid even with no tax.
  const [c1, c2] = FED.college[joint ? 'joint' : 'other'];
  const perStudent = u.collegeStudents > 0 ? u.collegeCost / u.collegeStudents : 0;
  const collegeFull = sep ? 0 : u.collegeStudents * (Math.min(2000, perStudent) + 0.25 * Math.min(2000, Math.max(0, perStudent - 2000))) * (1 - clamp01((magi - c1) / (c2 - c1)));
  const college = take(collegeFull * 0.6);
  const collegeBack = collegeFull * 0.4;
  // Children under 17 ($2,200 each) and other dependents ($500 each); shrinks above $200,000 ($400,000 joint).
  const familyFull = Math.max(0, u.ctcKids * FED.childTaxCredit + u.otherDeps * FED.otherDependent - 50 * Math.ceil(Math.max(0, magi - (joint ? 400000 : 200000)) / 1000));
  const family = take(familyFull);
  // What the child credit couldn't use is paid out, up to $1,700 a child and 15% of earnings over $2,500.
  const childBack = Math.min(familyFull - family, u.ctcKids * FED.childRefundable, 0.15 * Math.max(0, earned - 2500));
  // Earned income credit: for lower earnings, larger with children; not for separate returns or with much investment income.
  const E = FED.eitc, k = Math.min(3, u.eitcKids);
  const investment = u.interest + u.dividends + Math.max(0, u.gains) + Math.max(0, u.rental);
  const childlessOk = people.some((p) => p.age == null || (p.age >= 25 && p.age < 65));
  const eitc = sep || investment > E.investmentLimit || earned <= 0 || (k === 0 && !childlessOk) ? 0
    : Math.max(0, Math.min(E.max[k], (E.max[k] / E.earned[k]) * earned) - (E.max[k] / ((joint ? E.endJoint : E.end)[k] - (joint ? E.startJoint : E.start)[k])) * Math.max(0, Math.max(agi, earned) - (joint ? E.startJoint : E.start)[k]));
  // Marketplace insurance: the credit the year's income really earns, against what was paid in advance.
  let market = 0, marketFull = 0;
  if (u.market && !sep && u.market.benchmark > 0) {
    const income = agi + (u.ss - ssTaxed);
    const share = income / (FED.market.poverty + FED.market.perPerson * (Math.max(1, u.market.people) - 1));
    if (share >= 1 && share <= 4) {
      let lo = 1, pct = 0.021;
      for (const [top, a, b] of FED.market.steps) { if (share <= top) { pct = top === 1.33 ? a : a + (b - a) * ((share - lo) / (top - lo)); break; } lo = top; pct = b; }
      marketFull = Math.max(0, u.market.benchmark - pct * income);
    }
    market = marketFull - u.market.advance; // above zero is more credit; below is advance money to pay back
  } else if (u.market && sep) market = -u.market.advance;
  const paidBack = childBack + eitc + collegeBack;
  return {
    seTax, seNet, halfSe, agi, magi, qbi, taxable, fedDeduction, standard, itemizing, itemizedTotal, senior, ssTaxed, studentLoan, taxBefore,
    credits: { care, college: college + collegeBack, family: family + childBack, eitc, market, marketFull, refundable: paidBack + Math.max(0, market) },
    fedIncomeTax: left - paidBack - market,
    fedRate: fed.rate, bracketFloor: fed.bracketFloor, bracketTop: fed.bracketTop,
  };
}

/** Arkansas for the household. Married couples are figured both together and separately on one return, and the lower is used. */
function arkansas(h, status, edu) {
  const two = status === 'joint' || status === 'separate';
  const person = (p, mine) => {
    if (!p) return { income: 0, exempt: 0 };
    // The first $6,000 of pensions and of IRA withdrawals after 59 1/2 is exempt; Social Security isn't taxed at all.
    const exempt = Math.min(AR.retirementExempt, p.pension + (p.iraOk ? p.ira : 0));
    return { income: p.wages + p.se + p.unemployment + p.pension + p.ira - exempt + (mine ? h.shared - h.adjustments - h.studentLoan : 0), exempt };
  };
  const a = person(h.people[0], true), b = person(two ? h.people[1] : null, false);
  const arTeachYou = edu.educators >= 2 ? edu.arDeduction / 2 : edu.arDeduction;
  // Itemizing in Arkansas: the federal items without state income tax, if that beats the standard deductions.
  const arAgi = Math.max(0, a.income + b.income);
  const itemized = h.itemized + h.mortgage + h.propertyTax + h.giving + Math.max(0, h.medical - 0.075 * arAgi);
  const standard = AR.standardDeduction * (two ? 2 : 1);
  const useItemized = itemized > standard;
  const share = arAgi > 0 ? Math.max(0, a.income) / arAgi : 1;
  const you = Math.max(0, a.income - arTeachYou - (useItemized ? itemized * share : AR.standardDeduction));
  const spouse = two ? Math.max(0, b.income - (edu.arDeduction - arTeachYou) - (useItemized ? itemized * (1 - share) : AR.standardDeduction)) : 0;
  // Personal credits: one for a single filer, two for a couple or a head of household, one per dependent,
  // one more for each person 65 or older, and another for a 65-year-old who used no retirement exemption.
  const over65 = h.people.slice(0, two ? 2 : 1).filter((p) => p && p.over65);
  const special = [a, b].filter((x, i) => h.people[i] && h.people[i].over65 && (two || i === 0) && x.exempt === 0).length;
  const credits = AR.personalCredit * ((status === 'single' ? 1 : 2) + h.dependents + over65.length + special);
  const separate = Math.max(0, arkansasTax(you) + arkansasTax(spouse) - credits);
  const together = Math.max(0, arkansasTax(Math.max(0, you + spouse)) - credits);
  return {
    arTax: two ? Math.min(separate, together) : together,
    arMethod: !two ? (status === 'hoh' ? 'as head of household' : 'as a single filer') : separate <= together ? 'separately on the same return' : 'jointly',
    arNetYou: you, arNetSpouse: spouse, arTopRate: you >= 26400 || spouse >= 26400 ? 0.037 : null, arItemizing: useItemized,
  };
}

/**
 * Any state but Arkansas, by the simple model in server/states.js. It answers in the same shape as
 * arkansas() (the `ar` names are kept so nothing else had to change): the tax, how it was figured,
 * the income it was charged on, and the rate on the last dollar.
 */
function otherState(code, f, status, dependents) {
  const two = status === 'joint' || status === 'separate';
  const r = simpleStateTax(code, { income: Math.max(0, f.agi - f.ssTaxed), two, dependents });
  return {
    arTax: r.tax, arMethod: STATES[code].none ? 'no income tax' : two ? "on a couple's table" : "on a single filer's table",
    arNetYou: r.taxable, arNetSpouse: 0, arTopRate: r.rate || null, arItemizing: false,
  };
}

/**
 * One full scenario. The older, flat inputs still work (yourWages, spouseWages, pretaxYou, pretaxSpouse,
 * kids, seNet as your own profit, adjustments, itemized, teaching, educators). `more` carries the rest:
 *   seSpouse, ages { you, spouse }, dependents { under17, other, eitc, under13 },
 *   income { ssYou, ssSpouse, pensionYou, pensionSpouse, iraYou, iraSpouse, unemploymentYou, unemploymentSpouse,
 *            interest, dividends, gains, rental, other },
 *   costs { studentLoan, care, collegeStudents, college, mortgage, propertyTax, stateTax, giving, medical },
 *   market { benchmark, advance, people }
 */
function scenario({ status = 'joint', state = 'AR', yourWages, spouseWages, pretaxYou, pretaxSpouse, kids, seNet, adjustments = 0, itemized = 0, teaching = 0, educators = 0, more = {} }) {
  const joint = status === 'joint', two = joint || status === 'separate';
  if (!two) { spouseWages = 0; pretaxSpouse = 0; educators = Math.min(1, educators); }
  const edu = { ...educatorSplit(teaching, educators), educators };
  const I = more.income || {}, C = more.costs || {}, D = more.dependents, ages = more.ages || {};
  const age = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const mk = (who, wages, se) => {
    const a = age(ages[who]);
    return { who, age: a, over65: a != null && a >= 65, iraOk: a == null || a >= 60, wages: Math.max(0, wages), se: Math.max(0, se || 0) };
  };
  const you = mk('you', yourWages - pretaxYou, seNet), spouse = two ? mk('spouse', spouseWages - pretaxSpouse, more.seSpouse) : null;
  const deps = D ? { ctcKids: n0(D.under17), otherDeps: n0(D.other), eitcKids: n0(D.eitc), careKids: n0(D.under13) } : { ctcKids: n0(kids), otherDeps: 0, eitcKids: n0(kids), careKids: n0(kids) };
  const shared = { interest: n0(I.interest), dividends: n0(I.dividends), gains: Number(I.gains) || 0, rental: Number(I.rental) || 0, other: n0(I.other) };
  const own = (who) => { const W = who === 'you' ? 'You' : 'Spouse'; return { ss: n0(I[`ss${W}`]), pension: n0(I[`pension${W}`]), ira: n0(I[`ira${W}`]), unemployment: n0(I[`unemployment${W}`]) }; };
  const oy = own('you'), os = two ? own('spouse') : { ss: 0, pension: 0, ira: 0, unemployment: 0 };
  const costs = { studentLoan: n0(C.studentLoan), careCost: n0(C.care), collegeStudents: n0(C.collegeStudents), collegeCost: n0(C.college), mortgage: n0(C.mortgage), propertyTax: n0(C.propertyTax), stateTax: n0(C.stateTax), giving: n0(C.giving), medical: n0(C.medical) };
  const market = more.market && n0(more.market.benchmark) + n0(more.market.advance) > 0 ? { benchmark: n0(more.market.benchmark), advance: n0(more.market.advance), people: n0(more.market.people) || (two ? 2 : 1) + deps.ctcKids + deps.otherDeps } : null;
  const none = { ss: 0, pensions: 0, unemployment: 0, interest: 0, dividends: 0, gains: 0, rental: 0, other: 0, ctcKids: 0, otherDeps: 0, eitcKids: 0, careKids: 0, careCost: 0, collegeStudents: 0, collegeCost: 0, adjustments: 0, studentLoan: 0, itemized: 0, mortgage: 0, propertyTax: 0, stateTax: 0, giving: 0, medical: 0, market: null, eduAbove: 0, eduExcess: 0, mustItemize: false };
  const mine = { ...none, ...shared, ...deps, ...costs, adjustments, itemized, market, eduAbove: edu.fedAboveLine, eduExcess: edu.fedExcess };
  let f;
  if (status === 'separate') {
    // Each spouse's own return, added together. Children, shared income and the deductions go on yours.
    const a = federal({ ...mine, people: [you], ss: oy.ss, pensions: oy.pension + oy.ira, unemployment: oy.unemployment }, 'separate');
    // If one spouse itemizes, the other has to as well.
    const b = federal({ ...none, people: [spouse], ss: os.ss, pensions: os.pension + os.ira, unemployment: os.unemployment, mustItemize: a.itemizing }, 'separate');
    f = { ...a, seTax: a.seTax + b.seTax, agi: a.agi + b.agi, qbi: a.qbi + b.qbi, taxable: a.taxable + b.taxable, fedDeduction: a.fedDeduction + b.fedDeduction, senior: 0, ssTaxed: a.ssTaxed + b.ssTaxed, fedIncomeTax: a.fedIncomeTax + b.fedIncomeTax, taxBefore: a.taxBefore + b.taxBefore };
  } else {
    f = federal({ ...mine, people: spouse ? [you, spouse] : [you], ss: oy.ss + os.ss, pensions: oy.pension + oy.ira + os.pension + os.ira, unemployment: oy.unemployment + os.unemployment }, status);
  }
  const ar = state !== 'AR' ? otherState(state, f, status, deps.ctcKids + deps.otherDeps) : arkansas({
    people: [{ ...you, ...oy }, spouse ? { ...spouse, ...os } : null],
    shared: shared.interest + shared.dividends + shared.gains + shared.rental + shared.other, adjustments, studentLoan: Math.min(2500, costs.studentLoan),
    itemized, mortgage: costs.mortgage, propertyTax: costs.propertyTax, giving: costs.giving, medical: costs.medical, dependents: deps.ctcKids + deps.otherDeps,
  }, status, edu);
  const c = f.credits;
  return {
    seTax: round(f.seTax), agi: round(f.agi), qbi: round(f.qbi), taxable: round(f.taxable),
    fedDeduction: round(f.fedDeduction), itemizing: f.itemizing, itemizedTotal: round(f.itemizedTotal),
    fedIncomeTax: round(f.fedIncomeTax), fedRate: f.fedRate, bracketFloor: f.bracketFloor, bracketTop: f.bracketTop,
    arTax: round(ar.arTax), arMethod: ar.arMethod, arNetYou: round(ar.arNetYou), arNetSpouse: round(ar.arNetSpouse), arTopRate: ar.arTopRate, arItemizing: ar.arItemizing,
    // What went into the federal figure, for the page to list.
    taxBefore: round(f.taxBefore), senior: round(f.senior), ssTaxed: round(f.ssTaxed), studentLoan: round(f.studentLoan),
    credits: { care: round(c.care), college: round(c.college), family: round(c.family), eitc: round(c.eitc), market: round(c.market), marketFull: round(c.marketFull), refundable: round(c.refundable) },
    total: round(f.fedIncomeTax + f.seTax + ar.arTax),
  };
}

export function estimateTax(input) {
  input = { ...input, status: statusOf(input.status), state: stateOf(input.state) };
  const more = input.more || {};
  // Self-employment profit, yours and your spouse's. The older single figure counts as yours.
  const seNet = Math.max(0, n0(input.vipkidIncome) - n0(input.vipkidExpenses)) + n0(more.seYou);
  const seSpouse = n0(more.seSpouse);
  const withSe = scenario({ ...input, seNet, more: { ...more, seSpouse } });
  const without = scenario({ ...input, seNet: 0, more: { ...more, seSpouse: 0 } });
  const extra = withSe.total - without.total;
  const gross = n0(input.vipkidIncome) + n0(more.seGross);
  // Married filing separately: what filing together would have come to, so the page can say which is lower.
  const jointTotal = input.status === 'separate' ? scenario({ ...input, status: 'joint', seNet, more: { ...more, seSpouse } }).total : null;
  return {
    year: TAX_YEAR, status: input.status, state: stateInfo(input.state), seNet: round(seNet + seSpouse), with: withSe, without, extra, jointTotal,
    teaching: educatorSplit(input.teaching || 0, input.status === 'joint' || input.status === 'separate' ? input.educators || 0 : Math.min(1, input.educators || 0)),
    extraFederal: withSe.fedIncomeTax + withSe.seTax - without.fedIncomeTax - without.seTax,
    extraArkansas: withSe.arTax - without.arTax,
    setAsideRate: gross > 0 ? Math.max(0, extra) / gross : 0,
    roomInBracket: withSe.bracketTop === Infinity ? null : round(withSe.bracketTop - withSe.taxable),
    constants: { fedStandardDeduction: BY_STATUS[input.status].standardDeduction, arStandardDeduction: AR.standardDeduction, brackets: BY_STATUS[input.status].brackets.map(([top, rate]) => ({ top: top === Infinity ? null : top, rate })) },
  };
}
