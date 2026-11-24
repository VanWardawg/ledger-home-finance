# Ledger

A household budget that lives on your own machine: accounts, spending, bills, a checking forecast,
a debt payoff plan and a running estimate of federal and state income tax.

## Starting

1. Install the add-on and start it. The first build takes a few minutes, longer on a small computer.
2. Open **Ledger** from the sidebar. A short setup guide asks about your household, accounts and paydays.
   You can skip it and come back to it from Settings.

Home Assistant signs you in, so Ledger asks for no password of its own in the sidebar. **Anyone who can
open your Home Assistant sidebar can open Ledger.** If people you would not show your finances to have
Home Assistant accounts, hide the Ledger panel from them or don't install it there.

## Getting your money in

- **By hand.** Add accounts and type purchases. Nothing leaves your machine.
- **Bank connection (optional).** Ledger reads balances and transactions through SimpleFIN Bridge, a
  separate paid service (about $15 a year, paid to them). Figures run about a day behind.
- **Files.** A CSV export from your bank, or a PDF or photo of a statement.

## AI features (optional)

The written recap, "Ask your CFO", reading receipts, pay stubs and statements, and logo and category
suggestions use Claude, from Anthropic. They are off until you paste an Anthropic API key of your own
in Settings, and you pay Anthropic for what you use. Settings lists what has been sent, and lets you
keep chosen categories out of it.

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
