import { desc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';

import { db } from '@/db/client';
import { groups } from '@/db/schema';
import { formatPaise } from '@/domain/money';
import { newId } from '@/lib/newId';

export default function Home() {
  const { data, error } = useLiveQuery(
    db.select().from(groups).where(isNull(groups.deletedAt)).orderBy(desc(groups.createdAt)),
  );

  const addTestGroup = async () => {
    await db.insert(groups).values({ id: newId(), name: `Test group ${data.length + 1}` });
  };

  if (error) return <Text style={styles.error}>{error.message}</Text>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{formatPaise(12345678)}</Text>
      <Button title="Add test group" onPress={addTestGroup} />
      <FlatList
        data={data}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => (
          <Text style={styles.row}>
            {item.name} · v{item.version} · {item.dirty ? 'unsynced' : 'synced'}
          </Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  row: { paddingVertical: 8, fontSize: 16 },
  error: { color: '#b00020', padding: 16 },
});