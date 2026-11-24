# Ledger

A household budget that lives on your own machine: accounts, spending, bills, a checking forecast,
a debt payoff plan and a running estimate of federal and state income tax.

## Starting

1. Install the add-on and start it. The first build takes a few minutes, longer on a small computer.
2. Open **Ledger** from the sidebar. A short setup guide asks about your household, accounts and paydays.
   You can skip it and come back to it from Settings.

Home Assistant signs you in, so Ledger asks for no password of its own in the sidebar. **Every Home
Assistant administrator can open Ledger; other users can't.** Home Assistant shows add-ons to
administrators only, and hiding the panel from someone's sidebar is a preference they can undo, not a
lock. If someone you would not show your finances to is an administrator, make them a regular user first,
or don't install Ledger there.

## Getting your money in

- **By hand.** Add accounts and type purchases. Nothing leaves your machine.
- **Bank connection (optional).** Ledger reads balances and transactions through SimpleFIN Bridge, a
  separate paid service (about $15 a year, paid to them). Figures run about a day behind.
- **Files.** A CSV export from your bank, or a PDF or photo of a statement.

## AI features (optional)

Ledger works without any AI. If you want the extras, Settings, "AI recap and logos" offers two ways:

- **The AI in your Home Assistant.** If you have an AI set up under Home Assistant's Settings, Devices &
  services (Anthropic, OpenAI, Google, Ollama and others provide an "AI Task"), Ledger can use it: no second
  key, and with a model on your own machine nothing leaves the house. This gives the basics: the dashboard
  recap, category suggestions, and a CFO that answers from your month's figures. Only Claude has been tried
  with it; other models may read less well.
- **An Anthropic key of your own.** Ledger talks to Claude directly, which is what it was built around and
  works best. This gives everything: the basics, plus reading receipts, statements and pay stubs, finding
  and drawing logos, and the full CFO, which looks things up in your data and on official tax sites and can
  suggest changes. You pay Anthropic for what you use.

Either way Ledger sends only what each job needs, Settings lists what has been sent, and you can keep
chosen categories away from the AI. The add-on asks for permission to call Home Assistant for two things only, and
only if you choose them: that AI Task, and reading one of your Home Assistant calendars for a side gig paid
by booked sessions (Settings, "Side gig"). It lists your AI Tasks and calendars, asks the AI Task, and
reads the calendar you picked. It changes nothing in Home Assistant.

## Using it outside the sidebar

To add Ledger to a phone's home screen or post purchases to it from a Shortcut, give it a port under
the add-on's **Network** settings. Set a Ledger password first (Settings, Password): without one,
Ledger refuses everything that doesn't come through Home Assistant.

## Your data

One SQLite file in the add-on's `/data` folder. It is included in Home Assistant's backups. Removing
the add-on removes it.

## The tax estimate

An estimate for the current tax year, not tax advice. Federal figures are worked out in detail.
Arkansas is worked out in detail; other states use a simpler table of rates, deductions and
exemptions and leave out local income taxes and each state's own credits. Check with a tax preparer
before relying on it.
