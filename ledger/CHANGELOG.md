# Changelog

## Unreleased (this fork)

- A model of your own. Settings, "AI recap and logos" has a new part, "A model of your own": give Ledger
  the address of a model server on your network (Ollama, LM Studio, or anything else that answers
  OpenAI-style requests) and choose a model. The dashboard recap, category suggestions, the money review
  and the CFO then run there, and nothing about your money leaves your network for those. Nothing is
  charged. Reading receipts, statements and pay stubs, finding logos and the official-site searches still
  need an Anthropic key; one that is saved is still used for those.
- The CFO on a model of your own looks things up step by step, as it does with Claude, when the model
  supports tool calls: the same read-only lookups, plus the money review. It is offered nothing that
  changes anything. A model without tool calls answers from the month's figures instead.
- Money review, at the top of Reports. What stands out, worked out by Ledger from your own history with
  no AI: categories running above or below their usual, where the month is heading, purchases unusually
  large for their shop, charges that look doubled, subscriptions whose price changed, new shops, the last
  three months against the three before, how many days your cash covers, and the age of your money (the
  figure YNAB shows). With a model of your own or Home Assistant's AI switched on, a button has it write
  the findings up in plain words; it is handed the finished figures and asked to add nothing.
- Moving in from YNAB. Settings, "Moving in from YNAB" reads YNAB's exported Register file (and its Plan
  file, if you choose it) and brings across each account, every transaction with the category you chose
  and its memo, and transfers as transfers. It learns where you file each shop and can take your latest
  month's amounts as budgets. Bringing the same files in again adds nothing twice. Category groups, flags,
  cleared marks, scheduled transactions and targets do not come across.
- Backups. Ledger now makes a whole copy of its database each night and keeps the last 7 (Settings,
  "Backups" changes the number), in a `backups` folder beside the database. A copy can also be made on
  the spot or downloaded. The copies are on the same disk as the database: include that folder in
  whatever backs up the machine.
- Tests, for the first time: `npm test` runs 34 checks of the review's arithmetic, the YNAB import, the
  model connection and the backups. Nothing in them needs a model or the internet.
- Fixed: switching Home Assistant's AI off no longer clears a different AI choice.

## 0.1.32

- Paydays for people who are retired or on benefits. When you add a payday you now say what it is: a
  paycheck from a job, Social Security or other benefits, a pension, or other regular income. Only a
  job is ever asked for a pay stub. For the others Ledger says plainly that the money counts as income
  but is not in the tax estimate unless you enter it yourself, with a link to where that is done.
- Paydays now points to Side gig for pay with no tax taken out.

## 0.1.31

- Fixed for plain Docker: a new copy could never set its password. Settings said to open Ledger "on the
  Mac that runs it", and with no password most of Settings stayed hidden, including the bank connection,
  the AI key and Updates. A browser on the computer that runs Docker, or on the same home network, can
  now set the first password. Nothing changes inside Home Assistant or on a copy that already has one.

## 0.1.30

- Currency: Settings, "Currency" (and the setup guide's first step) lets a household choose the money it
  uses, from 22 currencies. Every amount is then written with that symbol, in the app, in the summary
  email and alerts, and in what the AI features are told. It changes how amounts are written only:
  nothing is converted, and a household has one currency. US dollars stay the default.
- Fixed for plain Docker on Windows: the two lines that update Ledger no longer use `&&`, which the
  terminal in Docker Desktop on Windows refuses. Updating is now `docker rm -f ledger`, then the start
  line with `--pull always`. If your copy's own "How to update" box still shows a line with `&&`, use
  the two lines in the README instead.

## 0.1.29

- Links that say where a setting is now take you to the setting itself: the right section opens, the
  exact box or switch is brought into view, and it is ringed for a moment so you can see which one is
  meant. "Turn on AI", "Connect your bank", the "needs AI" messages and every "Show me" under What's
  new all work this way.

## 0.1.28

- About, "Ask for something or report a problem": on a copy you run yourself, this now opens this
  project's issues page on GitHub, where reports are read. Before, what you typed was saved on your own
  copy and reached nobody. Nothing is sent from Ledger; the button only opens the page.

## 0.1.27

- Ledger run with plain Docker now says on the dashboard when a newer version is out, with what changed
  and the two lines that update it. It looks at this project's page on GitHub once a day, sends nothing
  about your household, and can be switched off in Settings, "Updates". Nothing changes inside Home
  Assistant, which already offers updates itself.

## 0.1.26

- An account can be left out of the budget (Accounts page, "Leave out of the budget"): its balance still
  shows, and its spending stops counting toward budgets and totals. Made for personal "fun money"
  accounts and children's accounts.

## 0.1.25

- Ledger started with plain Docker and no time zone now takes its time zone from the first browser that
  opens it, so "today" is your today and not world time. Home Assistant already gives Ledger the house's
  time zone, so nothing changes there.

## 0.1.24

- Ledger now arrives ready-made. Home Assistant downloads a finished image in place of building it on
  your own machine, so installing and updating take about a minute, not ten or more on a small computer.
- For plain Docker there is a ready-made image too, started with one line (see the README).

## 0.1.23

- A page left open from before an update no longer goes blank: it reloads itself once when its files have been replaced.

## 0.1.22

- The bank section in Settings is now "SimpleFIN Sync", with SimpleFIN's logo beside it.

## 0.1.21

- On a phone, the "filed under Other" card on Transactions no longer squeezes its words into a narrow strip.
- A copy hosted behind a web sign-in with no Ledger password can reach the bank token box and the rest of Settings (this never affected the add-on).

## 0.1.20

- Settings, "Bank connection" is now "Bank connection (SimpleFIN)", with numbered steps and a full-width box plainly marked "SimpleFIN setup token".

## 0.1.19

- Sensors: the page and these notes now say plainly that a sensor you switch on can be read by every Home Assistant login, not only administrators.
- A sensor with nothing to report says what it needs (a checking account, a payday, a budget).
- The number sensors carry units and classes, so Home Assistant can graph them and keep statistics. "Left before payday" is in USD.
- Switching off a sensor that was never on no longer creates it in Home Assistant.

## 0.1.18

- Optional sensors for your automations: a bill due tomorrow, checking forecast to run low, a budget over, days until payday, what is left before payday, and budget used. Each is off until you switch it on in Settings, "Home Assistant sensors".

## 0.1.17

- Settings, "Download your data" and these notes now explain how Ledger is backed up: it is part of Home Assistant's own backups, which can keep an encrypted copy off your machine.

## 0.1.16

- The first Ledger password can only be set from inside Home Assistant. A port you open yourself can never be used to claim the copy.

## 0.1.15

- Setup guide, first step: on a computer the Save button lines up with its boxes, and the closing sentence reads correctly.

## 0.1.14

- Answering "which job was this deposit for?" only accepts money in, and says so plainly when it is sent something else.

## 0.1.13

- A job is now matched to money you typed in yourself, such as cash in hand: a deposit that carries the gig's words counts even when it was filed as plain Income, and is moved under the gig once matched.
- Reading a calendar with no word filter no longer keeps its events' titles, only their times.
- Home Assistant is asked for your calendars only while a gig is set to "By booked sessions".
- Clearer message when a chosen Home Assistant calendar can't be read, and a note when the forecast has nothing to estimate from.
- The notes say how to switch on Watchdog.

## 0.1.12

- Every side gig can now say how it pays (Settings, "Side gig"): the average of its deposits as before; about the same each week or month; booked sessions read from a calendar at your own rate; or jobs you type in with what you expect and when.
- A booking calendar can be one of your Home Assistant calendars, with nothing to paste, or a private iCal address. For the first, the add-on reads that calendar's events from Home Assistant: a third call, read-only like the other two.
- The forecast uses a labelled estimate past your last booked session and in weeks with no job typed in.
- Jobs past their pay day move to "Owed to you" and stay until you say what happened; the dashboard mentions them.
- A deposit close to a job's amount ticks it off only when it is the one job it could be; otherwise Ledger asks.
- With no budgets set, an AI-written recap no longer reports spending against "a $0 budget".
- Fetching shops' logos from the internet can be switched off in Settings, "AI recap and logos", and the setup guide's last step says so and offers the switch.
- If Ledger stops answering, Home Assistant now starts it again.
- Everyone who installs this version builds from the same pinned base.
- The notes are corrected on who can open Ledger: Home Assistant administrators, and nobody else.

## 0.1.11

- With no debts recorded, the recap no longer mentions a debt-free date or a mortgage.
- The basic CFO sees the Cash account in the same list as your other accounts.

## 0.1.10

- The basic CFO now sees your Cash account as well, so what it says agrees with the Accounts page.
- An answer from Home Assistant that Ledger can't read is reported in Ledger's own words.

## 0.1.9

- Tightened how Ledger uses its permission to call Home Assistant: its token only ever goes to Home Assistant itself, only two calls can be made with it (listing the AI Tasks, and asking one), and the chosen AI is checked to be an AI Task before every call.
- Settings shows the AI as "On" when Home Assistant's AI is in use.

## 0.1.8

- A second way to the AI features: Ledger can use the AI already set up in your Home Assistant (its AI Task), with no second key. Choose it in Settings, "AI recap and logos". It gives the basics: the dashboard recap, category suggestions and a CFO that answers from your month's figures. An Anthropic key of your own still gives everything, and works best.
- For this the add-on now asks for permission to call Home Assistant. It uses it for the AI Task only, and only if you switch that on.
- With a model that isn't Claude, the CFO is your "Chief Financial Officer".

## 0.1.7

- The state menu has "Not in the United States", in the setup guide and on the Taxes page. Choosing it switches the tax section off; choosing a state later switches it back on.
- The setup guide follows that choice: it leaves out the questions about filing taxes and passes over its Taxes step.
- The setup guide's welcome now says the copy lives on your own machine.
- "Suggest budgets for me" works on a new copy again, with or without an AI key: from your spending once a month of it is in, otherwise from your paydays.

## 0.1.6

- No state is assumed any more. The Taxes page asks you to choose yours first, from a map of the United States or a list, and shows nothing else until you do.
- Not in the United States? The tax section can be switched off, on that first screen or in Settings, "Tax section". It leaves the menu, and Ledger stops holding money back for tax and asking for pay stubs.

## 0.1.5

- Ledger now stops cleanly when Home Assistant asks it to (a backup, an update, a restart). Before, it was shut off after a ten-second wait and showed as "error" for a moment during backups.
- This changelog.

## 0.1.4

- A new copy starts on the plain look. The holiday and season scenes are still in Settings, Appearance.

## 0.1.3

- A new copy starts with no budgets set, and the dashboard's summary says so, in place of starter amounts nobody chose.
- Added a clock check, so you can see which time zone Ledger is working by.

## 0.1.2

- "Today" in the checking estimate always follows your Home Assistant's time zone.
- The Apple Pay section is hidden here, since it cannot work inside Home Assistant.
- The guided tour leaves out the stop about adding Ledger to a phone's home screen.
- Home Assistant pauses Ledger for the few seconds a backup takes, so the database is always copied whole.

## 0.1.1

- Settings now shows every section straight away. Home Assistant signs you in, so no Ledger password is needed; before, most of Settings stayed hidden until one was set.

## 0.1.0

- First version as a Home Assistant add-on: opens from the sidebar, keeps its data in the add-on's own folder, and opens no network port unless you choose one.
