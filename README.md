# Ledger

A household budget you run yourself. One small server, one SQLite file, no account with anyone:
your finances stay on a machine you own.

Ledger began as one family's replacement for a paid budgeting app and grew from there. It is a
personal project, shared as it is. It is not a product, and nobody is on call for it.

## What it does

- **Dashboard**: what is left before payday, what is in checking now, spending against budget.
- **Transactions**: from a bank connection, typed by hand, read from a receipt or statement, or
  imported from a file. Split a purchase across categories; leave one out; undo a removal.
- **Budgets**: a set amount for each category, or "give every dollar a job" (zero-based). Unspent
  money can carry over.
- **Recurring bills**: found in your transactions or added by hand on any rhythm, with a forecast of
  your checking balance through the next two paydays.
- **Debt**: a payoff plan, graphs of each debt heading to zero, standing extra payments, and what
  you have paid toward each this month.
- **Taxes**: a running estimate of federal income tax, self-employment tax and state income tax for
  the year, with pay stubs month by month, purchases that might be deductible, and a pack to hand to
  a tax preparer. **An estimate, not tax advice.**
- **Savings goals, investments** (balances, and prices if you switch them on), **statement checks**.
- **Ask your CFO** and other optional AI features, run on your own Anthropic API key, or, inside Home Assistant, on the AI you already have set up there (the basics; Claude by key does the most).
- Works on a phone and can be added to its home screen.

## Running it

### Docker

```bash
docker compose up -d --build
```

Then open `http://<your server>:4317`. The database is created in `./data`. A new copy starts with
sample data so you can look around; your first bank connection or import replaces it.

Set a password in Settings before the port is reachable by anyone you would not show your finances
to. Ledger has no TLS of its own: put it behind a reverse proxy, a VPN such as Tailscale, or a
tunnel with its own sign-in if you want to reach it from outside your home.

### Home Assistant add-on

Add this repository to the add-on store (Settings, Add-ons, Add-on Store, ⋮, Repositories), install
**Ledger**, start it, and open it from the sidebar. See [the add-on's notes](ledger/DOCS.md).

The add-on asks for permission to call Home Assistant's API. Home Assistant offers no narrower permission
than that, so here is exactly what Ledger does with it: nothing at all unless you choose "The AI in your
Home Assistant" in Ledger's Settings, and then two calls only: it lists your AI Tasks for a menu, and it
asks the one you chose (`ai_task.generate_data`). The code is in `ledger/server/haai.js`.

### From source

```bash
npm ci
npm run build
NODE_ENV=production LEDGER_DATA_DIR=./data PORT=4317 node server/index.js
```

Node 24 or newer (it uses Node's built-in SQLite).

## Settings you can pass in the environment

| Variable | What it does |
|---|---|
| `LEDGER_DATA_DIR` | Folder for the database. `/data` in the container. |
| `PORT`, `HOST` | Where to listen. 4317 and all addresses in the container. |
| `TZ` | Your time zone, so "today" and paydays are right. |
| `LEDGER_FRESH=1` | Start empty with the setup guide, in place of sample data. |
| `LEDGER_INGRESS=1` | Home Assistant add-on mode: trust requests from the Supervisor, allow framing. |
| `LEDGER_SETUP_CODE` | For a copy you host for another household: a one-time code they use to claim it. |
| `LEDGER_AI_KEY`, `LEDGER_AI_MONTHLY_LIMIT`, `LEDGER_AI_MODEL` | An Anthropic key the host pays for on such a copy, with a monthly ceiling. |

## What leaves your machine

Nothing, unless you switch it on:

- **Bank connection**: Ledger asks SimpleFIN Bridge (a separate paid service you sign up for) for
  your balances and transactions. Your bank password never reaches Ledger.
- **AI features**: what each one sends to Anthropic is described in the app (About, and Settings,
  "What has been sent to Claude"). Off until you add a key.
- **Logos**: a merchant's website name is sent to a logo service to fetch its icon.
- **Investment prices**: ticker symbols only, off until switched on.
- **Summary email and alerts**: through a mail account you set up.

## The tax estimate

For tax year 2026. Federal figures follow IRS Rev. Proc. 2025-32. Arkansas is worked out in detail
from the state's own worksheet. Every other state uses one table of rates, standard deductions and
personal exemptions (the Tax Foundation's compilation as of January 1, 2026) and leaves out local
income taxes, each state's own credits, and more: see `server/states.js` for the list. The constants
need updating each January. Do not file from it.

## Notes for anyone reading the code

React, TypeScript and Vite in `src/`; one Express process in `server/` with Node's `node:sqlite`,
no ORM. Tables are created and migrated at start-up by the module that owns them. Amounts are
negative for money out. Some internal names (`vipkid`, `ar…`) are older than the features they now
serve.

Ledger was written with Claude, Anthropic's AI model, and uses the Claude API for its optional AI
features. It is not made, endorsed or supported by Anthropic.

## License

MIT. See `LICENSE`. Free to use, change and share; it comes with no warranty.
