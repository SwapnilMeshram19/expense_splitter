import { StyleSheet, Text, View } from 'react-native';
import { formatPaise, formatPaiseCompact } from '@/domain/money';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.amount}>{formatPaise(12345678)}</Text>
      <Text style={styles.sub}>{formatPaiseCompact(3_45_00_000_00)}</Text>
      <Text style={styles.sub}>Phase 0 OK</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  amount: { fontSize: 28, fontWeight: '600' },
  sub: { fontSize: 16, opacity: 0.7 },
});