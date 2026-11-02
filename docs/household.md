# Home services

Milk, newspaper, water cans (paid per unit) and a maid or cook (a monthly fee) tracked inside a
group, with the month's bill posted to the group as an ordinary expense.

## Model

| Piece | Where |
| ----- | ----- |
| Rules: bill maths, schedules, validation, text | `src/domain/household.ts` (shared with the server) |
| Commands | `household.create / update / delete / mark / postBill` in `src/domain/commands.ts` |
| Tables, RLS, snapshot, apply layer | `supabase/migrations/20261102120000_household_services.sql` |
| Screens | `src/app/groups/[groupId]/household/` (list, calendar + bill, add/edit) |
| View models (testable, web-ready) | `src/features/household/view.ts`, `serviceForm.ts` |

- **Only exceptions are stored.** A day without a mark is "as usual": the usual quantity on the
  service's weekdays, nothing otherwise. A month of milk is usually 0–5 rows.
- **Quantities** are hundredths of a unit (1.5 L = 150). Litres and kilos step by 0.5, everything
  else by 1.
- **Prices have history.** A new price starts on a date ("1st of this month", "today" or "all
  days"); earlier days keep the old price. The edit form builds the history, the planner checks it.
- **Monthly fee** = fee × paid days ÷ working days of the whole month (the service's weekdays).
  So a mid-month start or a mid-month raise is pro rata. The first `paidLeaves` absences in a month
  are free; later ones are cut.
- **Rounding:** one half-up rounding per price in the month, and the bill total is the sum of
  those lines, so the breakdown always adds up to the posted amount exactly.

## Marking a day

`household.mark { serviceId, date, qty | null, expected }`

- The mark id is `uuidv5(HOUSEHOLD_NAMESPACE, '<service>/<date>')`, checked by the table: two phones
  marking the same day write the same row.
- Marks are never deleted. `qty: null` = back to usual, and the row keeps its version.
- `expected` is what the day was on this phone. If someone else changed it meanwhile the server
  answers `MARK_CONFLICT` instead of overwriting. If they set the same thing, it's a no-op.
- **Queueable offline** (the only queued op that changes a row). A refused queued mark stays on
  *Not saved yet*: **Try again** re-bases it on the current value (keep mine), **Discard** keeps
  theirs. Never silently overwritten.
- No history entry per mark (it would flood Activity). Service create / edit / remove are logged.
- Days can be changed from 366 days back to 62 days ahead (planned absences while travelling).

## Posting the bill

`household.postBill { serviceId, month, upTo, expenseId, expectedExpenseVersion, paidByMemberId, memberIds }`

- The **amount is computed by the planner** from the marks: the phone never sends it.
- It becomes an ordinary expense (category Other, label "Home", equal split, the breakdown as its
  note), so balances, simplify-debts, UPI settle-up, insights and history need nothing new.
- The service row keeps `bills['YYYY-MM'] = expense id` in the same all-or-nothing command.
  Posting again updates that expense in place (version-checked); if someone deleted it, a new one
  is posted.
- In the current month `upTo` is the phone's today (the server allows one day ahead of UTC). When
  marks change after posting, the screens say "bill changed" and offer **Update the posted bill**.

## Snapshot size

`group_snapshot` carries live services and their marks from the last 400 days (older days can't be
changed or billed). `group_rev` includes both tables, so a mark refreshes other phones like any edit.

## Deploy

```bash
npm run db:push                       # the migration
npm run functions:deploy -- api       # the planner knows the new commands
```

Both before releasing the app build: an `api` function that doesn't know the new commands refuses
the whole request (`INVALID_COMMANDS`), and a queued batch that contains one would show as not
saved. Old app builds never send or see these tables.

Test: `psql -v ON_ERROR_STOP=1 -f supabase/tests/household_smoke.sql` (rolled back).

## Free tier

- Each saved mark is one Edge Function call (free plan: 500,000 a month). Days are as usual by
  default and the − / + stepper waits 0.7 s before saving, so a typical home sends a few a week.
- Rows: one per changed day, ~150 bytes. 10,000 active homes ≈ a few MB a year.

## Not yet

- Vendor's UPI ID on a service (pay the milkman from the bill). Needs the same masking as member
  UPI IDs in the history.
- Daily reminder ("Mark today's milk?") through the existing local notifications.
- Hindi / Marathi labels for units.
