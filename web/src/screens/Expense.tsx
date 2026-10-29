/**
 * Add / edit an expense. All the logic is the app's own (features/expenses/formState.ts:
 * parsing, live hints, previews, the draft); this file only renders it, so a split looks and
 * rounds exactly as on the phone and as the server will store it.
 *
 * Not in this version (the app has them): bills in another currency, receipt photos, repeating
 * expenses. Editing an expense that has them keeps them as they are.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';

import { dataStore } from '@/data';
import { runCommand, useData } from '@/data/hooks';
import {
  formatMoney,
  readableAmount,
  sanitizeMoneyInput,
  type CurrencyCode,
} from '@/domain/currency';
import { MAX_DESCRIPTION_LENGTH } from '@/domain/expenseValidation';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/domain/model';
import { MAX_NOTE_LENGTH } from '@/domain/note';
import { CATEGORY_NAMES } from '@/features/expenses/categoryNames';
import {
  analyzeForm,
  sanitizeSplitInput,
  type DraftParts,
  type ExpenseFormState,
  type FormMember,
  type SplitMode,
} from '@/features/expenses/formState';
import { loadFormSetup, type FormSetup } from '@/features/expenses/loadFormSetup';
import { describeExpenseError } from '@/features/expenses/messages';
import { describeCommonFailure } from '@/features/data/messages';
import { newId } from '@/lib/newId';

import { useScreenOpen } from '../ui/hooks';
import { Card, ErrorText, Field, Icon, Message, Segmented, Spinner } from '../ui/kit';

const SPLIT_MODES: readonly { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Amounts' },
  { value: 'percentage', label: '%' },
  { value: 'shares', label: 'Shares' },
];

export function ExpenseScreen({
  groupId,
  expenseId,
}: {
  groupId: string;
  expenseId: string | null;
}) {
  useScreenOpen(expenseId ? 'Edit expense' : 'Add expense');
  // Read when the group is available (a direct link may arrive before the first fetch), then fixed.
  const setup = useData(
    () => (dataStore().group(groupId) ? loadFormSetup(groupId, expenseId) : null),
    [groupId, expenseId],
  );
  const loading = useData(() => !dataStore().getStatus().loadedFromServer);
  // The form starts from the first good setup and keeps it: a refetch mid-typing never resets it.
  const [frozen, setFrozen] = useState<Extract<FormSetup, { ok: true }> | null>(null);
  const current = frozen ?? (setup?.ok ? setup : null);
  if (!frozen && current) setFrozen(current);

  if (current) return <ExpenseForm groupId={groupId} expenseId={expenseId} setup={current} />;
  if (!setup) return loading ? <Spinner /> : <Message title="This group no longer exists." />;
  return (
    <Message title={setup.ok ? '' : setup.message}>
      <Link href={`/groups/${groupId}`} className="btn">
        Back to the group
      </Link>
    </Message>
  );
}

function ExpenseForm({
  groupId,
  expenseId,
  setup,
}: {
  groupId: string;
  expenseId: string | null;
  setup: Extract<FormSetup, { ok: true }>;
}) {
  const [, navigate] = useLocation();
  const [state, setState] = useState<ExpenseFormState>(setup.initialState);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = setup.members;
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const groupCurrency = setup.groupCurrency;
  const analysis = useMemo(
    () => analyzeForm(state, memberIds, groupCurrency, null),
    [state, memberIds, groupCurrency],
  );
  const entry: CurrencyCode = analysis.entryCurrency;
  const isForeign = entry !== groupCurrency;
  const patch = (p: Partial<ExpenseFormState>) => setState((s) => ({ ...s, ...p }));
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';
  const back = () => navigate(`/groups/${groupId}`, { replace: true });

  const save = async (draft: DraftParts) => {
    // Receipts and repeats aren't edited here: the draft keeps the stored receipt id as is.
    const { stagedReceipt: _staged, repeat: _repeat, ...fields } = draft;
    const result = expenseId
      ? await runCommand('expense.update', {
          ...fields,
          groupId,
          expenseId,
          expectedVersion: setup.expectedVersion,
        })
      : await runCommand('expense.add', { ...fields, groupId, id: newId() });
    if (!result.ok) {
      setError(describeExpenseError(result.error, nameOf, { entry, group: groupCurrency }));
      return;
    }
    back();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setShowProblems(true);
    setError(null);
    if (!analysis.draft) return;
    setSaving(true);
    await save(analysis.draft);
    setSaving(false);
  };

  const remove = async () => {
    if (!expenseId || !window.confirm(`Delete “${state.description}”? Everyone’s balances change.`))
      return;
    setSaving(true);
    const result = await runCommand('expense.delete', {
      groupId,
      expenseId,
      expectedVersion: setup.expectedVersion,
    });
    setSaving(false);
    if (!result.ok)
      return setError(
        describeCommonFailure(result.error) ?? 'Couldn’t delete it. Please try again.',
      );
    back();
  };

  const amountHint = readableAmount(state.amountText, entry);

  return (
    <form onSubmit={(e) => void submit(e)} className="stack" style={{ gap: 16 }} noValidate>
      <div className="row">
        <Link href={`/groups/${groupId}`} className="icon-btn" aria-label="Back to the group">
          <Icon name="back" />
        </Link>
        <h1 className="grow">{expenseId ? 'Edit expense' : 'Add expense'}</h1>
      </div>

      <Card>
        <Field label="Description">
          <input
            className="input"
            value={state.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Dinner, cab, groceries…"
            maxLength={MAX_DESCRIPTION_LENGTH}
            autoFocus={!expenseId}
          />
        </Field>
        <Field label={`Amount (${entry})`} hint={amountHint}>
          <input
            className="input amount-input"
            inputMode="decimal"
            value={state.amountText}
            onChange={(e) =>
              patch({ amountText: sanitizeMoneyInput(e.target.value, state.amountText, entry) })
            }
            placeholder="0"
          />
        </Field>
        {isForeign ? (
          <p className="small muted">
            Bill in {entry} at a locked rate of {state.rateText} {groupCurrency}
            {analysis.convertedTotal !== null
              ? ` = ${formatMoney(analysis.convertedTotal, groupCurrency)}`
              : ''}
            .
          </p>
        ) : null}
        <div className="row wrap">
          <Field label="Date">
            <input
              className="input"
              type="date"
              value={state.expenseDate}
              onChange={(e) => e.target.value && patch({ expenseDate: e.target.value })}
            />
          </Field>
          <Field label="Category">
            <select
              className="input"
              value={state.category}
              onChange={(e) => patch({ category: e.target.value as ExpenseCategory })}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_NAMES[c]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {state.category === 'other' ? (
          <Field label="Category name (optional)">
            <input
              className="input"
              value={state.categoryLabel}
              onChange={(e) => patch({ categoryLabel: e.target.value })}
              list="category-suggestions"
              placeholder="Petrol, Gifts…"
            />
            <datalist id="category-suggestions">
              {setup.categorySuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        ) : null}
      </Card>

      <Card>
        <div className="row">
          <h2 className="grow">Paid by</h2>
          <Segmented
            label="Who paid"
            value={state.payerMode}
            options={[
              { value: 'single', label: 'One person' },
              { value: 'multiple', label: 'Several' },
            ]}
            onChange={(payerMode) => patch({ payerMode })}
          />
        </div>
        {state.payerMode === 'single' ? (
          <select
            className="input"
            value={state.singlePayerId}
            onChange={(e) => patch({ singlePayerId: e.target.value })}
            aria-label="Who paid"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <AmountRows
            members={members}
            values={state.payerAmounts}
            onChange={(id, v) =>
              patch({
                payerAmounts: {
                  ...state.payerAmounts,
                  [id]: sanitizeMoneyInput(v, state.payerAmounts[id] ?? '', entry),
                },
              })
            }
            placeholder="0"
            label="paid"
          />
        )}
        {analysis.payerHint ? <p className="small warning">{analysis.payerHint}</p> : null}
      </Card>

      <Card>
        <h2>Split</h2>
        <Segmented
          label="How to split"
          value={state.splitMode}
          options={SPLIT_MODES}
          onChange={(splitMode) => patch({ splitMode })}
        />
        {state.splitMode === 'equal' ? (
          <div>
            {members.map((m) => {
              const checked = state.equalMemberIds.includes(m.id);
              const share = analysis.preview.get(m.id);
              return (
                <label key={m.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      patch({
                        equalMemberIds: checked
                          ? state.equalMemberIds.filter((id) => id !== m.id)
                          : [...state.equalMemberIds, m.id],
                      })
                    }
                  />
                  <span className="grow">{m.name}</span>
                  <span className="amount small muted">
                    {checked && share !== undefined ? formatMoney(share, entry) : ''}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <AmountRows
            members={members}
            values={
              state.splitMode === 'exact'
                ? state.exactAmounts
                : state.splitMode === 'percentage'
                  ? state.percentages
                  : state.shares
            }
            onChange={(id, v) => {
              const mode = state.splitMode as Exclude<SplitMode, 'equal'>;
              const key =
                mode === 'exact'
                  ? 'exactAmounts'
                  : mode === 'percentage'
                    ? 'percentages'
                    : 'shares';
              const current = state[key];
              patch({
                [key]: { ...current, [id]: sanitizeSplitInput(mode, v, current[id] ?? '', entry) },
              });
            }}
            placeholder={
              state.splitMode === 'shares' ? '0' : state.splitMode === 'percentage' ? '0%' : '0'
            }
            label={
              state.splitMode === 'shares'
                ? 'shares'
                : state.splitMode === 'percentage'
                  ? 'percent'
                  : 'owes'
            }
            preview={(id) => {
              const v = analysis.preview.get(id);
              if (v === undefined || state.splitMode === 'exact') return '';
              return `${analysis.previewIsEstimate ? '≈ ' : ''}${formatMoney(v, entry)}`;
            }}
          />
        )}
        {analysis.splitHint ? <p className="small warning">{analysis.splitHint}</p> : null}
      </Card>

      <Card>
        <Field label="Note (optional)">
          <textarea
            className="input"
            value={state.note}
            onChange={(e) => patch({ note: e.target.value })}
            maxLength={MAX_NOTE_LENGTH}
          />
        </Field>
        {state.receiptId ? (
          <p className="small muted">Has a receipt photo. Open it in the app.</p>
        ) : null}
      </Card>

      {showProblems && analysis.problems[0] ? <ErrorText>{analysis.problems[0]}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn block" disabled={saving}>
        {saving ? 'Saving…' : expenseId ? 'Save changes' : 'Save expense'}
      </button>
      {expenseId ? (
        <button
          type="button"
          className="btn danger block"
          disabled={saving}
          onClick={() => void remove()}
        >
          Delete expense
        </button>
      ) : null}
    </form>
  );
}

function AmountRows({
  members,
  values,
  onChange,
  placeholder,
  label,
  preview,
}: {
  members: FormMember[];
  values: Record<string, string>;
  onChange: (memberId: string, value: string) => void;
  placeholder: string;
  label: string;
  preview?: (memberId: string) => string;
}) {
  return (
    <div>
      {members.map((m) => (
        <div key={m.id} className="check-row">
          <span className="grow ellipsis">{m.name}</span>
          {preview ? <span className="amount small muted">{preview(m.id)}</span> : null}
          <input
            className="input narrow"
            inputMode="decimal"
            value={values[m.id] ?? ''}
            onChange={(e) => onChange(m.id, e.target.value)}
            placeholder={placeholder}
            aria-label={`${m.name} ${label}`}
          />
        </div>
      ))}
    </div>
  );
}
