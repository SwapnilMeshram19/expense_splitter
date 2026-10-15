import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import {
  MAX_PAY_METHODS,
  methodSummary,
  methodTitle,
  validatePayMethod,
  type PayMethod,
  type PayMethodKind,
} from '@/domain/payMethods';
import { AppText } from '@/ui/AppText';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FieldLabel, Input } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { ListRow, listCardStyle } from '@/ui/ListRow';
import { useTheme } from '@/ui/theme';

import { describePayMethodError, iconForKind, METHOD_CHOICES } from './messages';

const EMPTY: Record<PayMethodKind, PayMethod> = {
  link: { kind: 'link', url: '' },
  iban: { kind: 'iban', name: '', iban: '', bic: '' },
  bank: { kind: 'bank', text: '' },
  pix: { kind: 'pix', key: '', name: '', city: '' },
  paynow: { kind: 'paynow', proxy: '', name: '' },
  promptpay: { kind: 'promptpay', id: '' },
};

interface Draft {
  /** Index being edited, or null for a new one. */
  index: number | null;
  method: PayMethod;
  error: string | null;
}

/**
 * UPI ID + other ways to get paid, for one person. Used by Account (your details, every group)
 * and by a group's member screen (one person, one group). The method form opens inline, not in a
 * modal, so the keyboard handling of the scroll view keeps every field visible.
 */
export function PayDetailsEditor({
  initialVpa,
  initialMethods,
  intro,
  footnote,
  saveLabel,
  onSave,
  extra,
}: {
  initialVpa: string | null;
  initialMethods: readonly PayMethod[];
  /** One short line above the form. */
  intro?: string;
  /** Who will see this. */
  footnote: string;
  saveLabel: string;
  /** Returns an error message, or null when saved. */
  onSave: (vpaText: string, methods: PayMethod[]) => string | null;
  /** Under the footnote (e.g. "Edit for all groups"). */
  extra?: ReactNode;
}) {
  const theme = useTheme();
  const [vpa, setVpa] = useState(initialVpa ?? '');
  const [methods, setMethods] = useState<PayMethod[]>([...initialMethods]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startNew = (kind: PayMethodKind) => {
    setChoosing(false);
    setDraft({ index: null, method: { ...EMPTY[kind] }, error: null });
  };

  const commitDraft = () => {
    if (!draft) return;
    const checked = validatePayMethod(draft.method);
    if (!checked.ok) {
      setDraft({ ...draft, error: describePayMethodError(checked.error) });
      return;
    }
    setMethods((list) =>
      draft.index === null ? [...list, checked.method] : list.map((m, i) => (i === draft.index ? checked.method : m)),
    );
    setDraft(null);
    setError(null);
  };

  const save = () => {
    if (draft) {
      setError('Finish or cancel the method you’re adding first.');
      return;
    }
    setError(onSave(vpa, methods));
  };

  return (
    <>
      <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {intro ? (
          <AppText color={theme.muted} style={styles.intro}>
            {intro}
          </AppText>
        ) : null}

        <Card style={styles.card}>
          <View style={styles.titleRow}>
            <AppText variant="heading" style={styles.grow}>
              UPI ID
            </AppText>
            <AppText variant="caption" color={theme.muted}>
              India
            </AppText>
          </View>
          <Input
            value={vpa}
            onChangeText={(text) => {
              setVpa(text);
              setError(null);
            }}
            placeholder="name@bank or UPI link"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            keyboardType="email-address"
            maxLength={1000}
            accessibilityLabel="UPI ID"
          />
        </Card>

        <Card style={[listCardStyle, styles.listCard]}>
          <AppText variant="heading" style={styles.listTitle}>
            Other ways to get paid
          </AppText>
          {methods.length === 0 && !draft ? (
            <AppText variant="label" color={theme.muted} style={styles.listEmpty}>
              For friends abroad: PayPal, IBAN, Pix and more.
            </AppText>
          ) : null}
          {methods.map((m, index) =>
            draft?.index === index ? null : (
              <ListRow
                key={`${m.kind}-${index}`}
                icon={iconForKind(m.kind)}
                title={methodTitle(m)}
                detail={methodSummary(m)}
                onPress={() => setDraft({ index, method: { ...m }, error: null })}
                last={index === methods.length - 1 && !draft}
                right={
                  <Pressable
                    onPress={() => setMethods((list) => list.filter((_, i) => i !== index))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${methodTitle(m)}`}
                    hitSlop={8}
                    style={styles.removeButton}
                  >
                    <Icon name="close" color={theme.muted} size={20} />
                  </Pressable>
                }
              />
            ),
          )}
          {draft ? (
            <MethodForm
              draft={draft}
              onChange={(method) => setDraft({ ...draft, method, error: null })}
              onDone={commitDraft}
              onCancel={() => setDraft(null)}
            />
          ) : methods.length < MAX_PAY_METHODS ? (
            <Button
              label="Add a way to get paid"
              icon="add"
              variant="soft"
              onPress={() => setChoosing(true)}
              style={styles.addButton}
            />
          ) : null}
        </Card>

        {error ? (
          <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
            {error}
          </AppText>
        ) : null}

        <Button label={saveLabel} icon="check" size="lg" onPress={save} />
        <AppText variant="caption" color={theme.muted} style={styles.centerText}>
          {footnote}
        </AppText>
        {extra}
      </KeyboardAwareScrollView>
      <KeyboardToolbar />

      <BottomSheet visible={choosing} onClose={() => setChoosing(false)} title="Add a way to get paid">
        <View>
          {METHOD_CHOICES.map((c, i) => (
            <ListRow
              key={c.kind}
              icon={c.icon}
              title={c.title}
              detail={c.detail}
              onPress={() => startNew(c.kind)}
              last={i === METHOD_CHOICES.length - 1}
            />
          ))}
        </View>
      </BottomSheet>
    </>
  );
}

function MethodForm({
  draft,
  onChange,
  onDone,
  onCancel,
}: {
  draft: Draft;
  onChange: (method: PayMethod) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const m = draft.method;
  const field = (
    label: string,
    value: string,
    set: (text: string) => void,
    props: Partial<ComponentProps<typeof Input>> = {},
  ) => (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <Input value={value} onChangeText={set} accessibilityLabel={label} autoCorrect={false} {...props} />
    </View>
  );

  return (
    <View style={[styles.form, { borderTopColor: theme.border }]}>
      <View style={styles.titleRow}>
        <Icon name={iconForKind(m.kind)} color={theme.onPrimarySoft} size={20} />
        <AppText variant="heading" style={styles.grow}>
          {METHOD_CHOICES.find((c) => c.kind === m.kind)?.title}
        </AppText>
      </View>

      {m.kind === 'link'
        ? field('Link', m.url, (url) => onChange({ ...m, url }), {
            placeholder: 'https://paypal.me/yourname',
            autoCapitalize: 'none',
            keyboardType: 'url',
            autoFocus: true,
          })
        : null}
      {m.kind === 'iban' ? (
        <>
          {field('Account holder', m.name, (name) => onChange({ ...m, name }), { autoCapitalize: 'words', autoFocus: true })}
          {field('IBAN', m.iban, (iban) => onChange({ ...m, iban }), {
            placeholder: 'DE89 3704 0044 0532 0130 00',
            autoCapitalize: 'characters',
          })}
          {field('BIC (optional)', m.bic ?? '', (bic) => onChange({ ...m, bic }), { autoCapitalize: 'characters' })}
        </>
      ) : null}
      {m.kind === 'bank'
        ? field('Bank details', m.text, (text) => onChange({ ...m, text }), {
            placeholder: 'Name, bank, account number, routing…',
            multiline: true,
            style: styles.multiline,
            textAlignVertical: 'top',
            autoFocus: true,
          })
        : null}
      {m.kind === 'pix' ? (
        <>
          {field('Pix key', m.key, (key) => onChange({ ...m, key }), {
            placeholder: 'CPF, phone, email or random key',
            autoCapitalize: 'none',
            autoFocus: true,
          })}
          {field('Name', m.name, (name) => onChange({ ...m, name }), { autoCapitalize: 'words' })}
          {field('City (optional)', m.city, (city) => onChange({ ...m, city }), { autoCapitalize: 'words' })}
        </>
      ) : null}
      {m.kind === 'paynow' ? (
        <>
          {field('Mobile number or UEN', m.proxy, (proxy) => onChange({ ...m, proxy }), {
            placeholder: '+65 9123 4567',
            autoCapitalize: 'characters',
            autoFocus: true,
          })}
          {field('Name (optional)', m.name, (name) => onChange({ ...m, name }), { autoCapitalize: 'words' })}
        </>
      ) : null}
      {m.kind === 'promptpay'
        ? field('Mobile number or ID', m.id, (id) => onChange({ ...m, id }), {
            placeholder: '081 234 5678',
            keyboardType: 'phone-pad',
            autoFocus: true,
          })
        : null}

      {draft.error ? (
        <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
          {draft.error}
        </AppText>
      ) : null}
      <View style={styles.row}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} style={styles.grow} />
        <Button label={draft.index === null ? 'Add' : 'Done'} icon="check" variant="soft" onPress={onDone} style={styles.grow} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, gap: 14 },
  intro: { textAlign: 'center' },
  card: { gap: 10 },
  listCard: { paddingTop: 14, paddingBottom: 14 },
  listTitle: { marginBottom: 4 },
  listEmpty: { paddingVertical: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  removeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  addButton: { marginTop: 8 },
  form: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 4 },
  field: { gap: 0 },
  multiline: { minHeight: 96, paddingTop: 12 },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  centerText: { textAlign: 'center' },
});
