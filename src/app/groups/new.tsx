import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { createGroup } from '@/db/repositories/groups';
import { MAX_NAME_LENGTH } from '@/db/repositories/names';
import { getSetting, SELF_NAME_KEY, setSetting } from '@/db/repositories/profile';
import { getDeviceUserId } from '@/db/session';
import { type CurrencyCode } from '@/domain/currency';
import { describeGroupError } from '@/features/groups/messages';
import { getRegionPreference } from '@/features/region/regionPreference';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { CurrencyPicker } from '@/ui/CurrencyPicker';
import { FieldLabel, Input } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

interface PersonField {
  key: number;
  name: string;
}

export default function NewGroupScreen() {
  const theme = useTheme();
  const nextKey = useRef(1);
  const [groupName, setGroupName] = useState('');
  const [selfName, setSelfName] = useState(() => getSetting(appContext, SELF_NAME_KEY) ?? '');
  const [people, setPeople] = useState<PersonField[]>([{ key: 0, name: '' }]);
  // Home currency (from the phone or Account): a US visitor's trip to India starts in USD.
  const [currency, setCurrency] = useState<CurrencyCode>(() => getRegionPreference().homeCurrency);
  const [error, setError] = useState<string | null>(null);

  const updatePerson = (key: number, name: string) =>
    setPeople((list) => list.map((p) => (p.key === key ? { ...p, name } : p)));
  const removePerson = (key: number) => setPeople((list) => list.filter((p) => p.key !== key));
  const addPerson = () => setPeople((list) => [...list, { key: nextKey.current++, name: '' }]);

  const submit = () => {
    const result = createGroup(appContext, {
      name: groupName,
      selfName,
      otherMemberNames: people.map((p) => p.name).filter((n) => n.trim() !== ''),
      deviceUserId: getDeviceUserId(),
      currency,
    });
    if (!result.ok) {
      setError(describeGroupError(result.error));
      return;
    }
    setSetting(appContext, SELF_NAME_KEY, selfName.trim());
    router.replace({ pathname: '/groups/[groupId]', params: { groupId: result.value.groupId } });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New group' }} />
      <KeyboardAwareScrollView
        bottomOffset={62}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <FieldLabel>Group name</FieldLabel>
        <Input
          value={groupName}
          onChangeText={setGroupName}
          placeholder="e.g. Goa trip, Flat 302"
          maxLength={MAX_NAME_LENGTH}
          accessibilityLabel="Group name"
          autoFocus
        />

        <FieldLabel>Currency</FieldLabel>
        <CurrencyPicker
          label="Group currency"
          value={currency}
          onChange={setCurrency}
          pinned={[getRegionPreference().homeCurrency]}
        />
        <AppText variant="caption" color={theme.muted}>
          {currency === 'INR'
            ? 'Balances and UPI settle-up are in rupees. Bills in other currencies are converted when you add them.'
            : 'Everyone settles up in this currency. Bills in other currencies are converted when you add them. UPI works only for rupee groups.'}
        </AppText>

        <FieldLabel>Your name</FieldLabel>
        <Input
          value={selfName}
          onChangeText={setSelfName}
          placeholder="How others see you"
          maxLength={MAX_NAME_LENGTH}
          accessibilityLabel="Your name"
        />

        <FieldLabel>People</FieldLabel>
        {people.map((person, index) => (
          <View key={person.key} style={styles.personRow}>
            <Input
              value={person.name}
              onChangeText={(name) => updatePerson(person.key, name)}
              placeholder="Name"
              maxLength={MAX_NAME_LENGTH}
              accessibilityLabel={`Person ${index + 1} name`}
              style={styles.personInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove person"
              onPress={() => removePerson(person.key)}
              style={styles.removeButton}
            >
              <Icon name="close" color={theme.muted} size={20} />
            </Pressable>
          </View>
        ))}
        <Button label="Add person" icon="personAdd" variant="soft" onPress={addPerson} style={styles.addPerson} />
        <AppText variant="caption" color={theme.muted}>
          People don’t need the app. You can invite them later.
        </AppText>

        {error ? (
          <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
            {error}
          </AppText>
        ) : null}

        <Button label="Create group" size="lg" onPress={submit} style={styles.submit} />
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 8, gap: 8, paddingBottom: 48 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  personInput: { flex: 1 },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addPerson: { alignSelf: 'flex-start', marginTop: 4 },
  submit: { marginTop: 20 },
});
