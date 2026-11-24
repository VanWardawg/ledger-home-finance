# Changelog

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
