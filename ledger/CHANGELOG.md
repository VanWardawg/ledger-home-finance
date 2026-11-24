# Changelog

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
