import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { createGroup } from '@/db/repositories/groups';
import { MAX_NAME_LENGTH } from '@/db/repositories/names';
import { getSetting, SELF_NAME_KEY, setSetting } from '@/db/repositories/profile';
import { getDeviceUserId } from '@/db/session';
import { describeGroupError } from '@/features/groups/messages';
import { useTheme, type Theme } from '@/ui/theme';

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
    });
    if (!result.ok) {
      setError(describeGroupError(result.error));
      return;
    }
    setSetting(appContext, SELF_NAME_KEY, selfName.trim());
    router.replace({ pathname: '/groups/[groupId]', params: { groupId: result.value.groupId } });
  };

  const input = inputStyle(theme);

  return (
    <>
      <Stack.Screen options={{ title: 'New group' }} />
      <KeyboardAwareScrollView
        bottomOffset={62}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: theme.muted }]}>Group name</Text>
        <TextInput
          value={groupName}
          onChangeText={setGroupName}
          placeholder="e.g. Goa trip, Flat 302"
          placeholderTextColor={theme.muted}
          maxLength={MAX_NAME_LENGTH}
          style={input}
          autoFocus
        />

        <Text style={[styles.label, { color: theme.muted }]}>Your name</Text>
        <TextInput
          value={selfName}
          onChangeText={setSelfName}
          placeholder="How others see you"
          placeholderTextColor={theme.muted}
          maxLength={MAX_NAME_LENGTH}
          style={input}
        />

        <Text style={[styles.label, { color: theme.muted }]}>People</Text>
        {people.map((person) => (
          <View key={person.key} style={styles.personRow}>
            <TextInput
              value={person.name}
              onChangeText={(name) => updatePerson(person.key, name)}
              placeholder="Name"
              placeholderTextColor={theme.muted}
              maxLength={MAX_NAME_LENGTH}
              style={[input, styles.personInput]}
            />
            <Pressable
              accessibilityLabel="Remove person"
              onPress={() => removePerson(person.key)}
              style={styles.removeButton}
              hitSlop={8}
            >
              <Text style={{ color: theme.muted, fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable onPress={addPerson} style={styles.addPerson}>
          <Text style={{ color: theme.primary, fontWeight: '600' }}>+ Add person</Text>
        </Pressable>
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          People don’t need the app. You can invite them later.
        </Text>

        {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={submit}
          style={({ pressed }) => [
            styles.submit,
            { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.submitText, { color: theme.onPrimary }]}>Create group</Text>
        </Pressable>
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const inputStyle = (theme: Theme) => [
  styles.input,
  { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
];

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 12, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  personInput: { flex: 1 },
  removeButton: { padding: 8 },
  addPerson: { paddingVertical: 10 },
  submit: { marginTop: 24, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitText: { fontSize: 16, fontWeight: '600' },
});