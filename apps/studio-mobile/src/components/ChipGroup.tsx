import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export type ChipOption = { value: string; label: string };

/** Compact horizontal chips for small enums (category / priority). */
export function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: ChipOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { color: colors.text, fontSize: 14, fontWeight: "500" },
  chipTextOn: { color: "#fff", fontWeight: "700" },
});
