import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
};

/** Tappable field that opens a bottom sheet picker. */
export function SelectField({
  label,
  required,
  valueLabel,
  placeholder,
  onPress,
  error,
}: {
  label: string;
  required?: boolean;
  valueLabel?: string;
  placeholder: string;
  onPress: () => void;
  error?: string;
}) {
  const empty = !valueLabel;
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>
        {label}
        {required ? <Text style={fieldStyles.req}> *</Text> : null}
      </Text>
      <Pressable
        style={[fieldStyles.field, error ? fieldStyles.fieldErr : null]}
        onPress={onPress}
      >
        <Text
          style={[fieldStyles.value, empty && fieldStyles.placeholder]}
          numberOfLines={1}
        >
          {valueLabel || placeholder}
        </Text>
        <Text style={fieldStyles.chevron}>›</Text>
      </Pressable>
      {error ? <Text style={fieldStyles.error}>{error}</Text> : null}
    </View>
  );
}

export function SelectSheet({
  visible,
  title,
  options,
  value,
  onChange,
  onClose,
  allowEmpty,
  emptyLabel = "不指定",
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const rows: SelectOption[] = allowEmpty
    ? [{ value: "", label: emptyLabel }, ...options]
    : options;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={sheetStyles.root}>
        <Pressable style={sheetStyles.backdrop} onPress={onClose} />
        <View style={[sheetStyles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.header}>
            <Text style={sheetStyles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={sheetStyles.done}>完成</Text>
            </Pressable>
          </View>
          <ScrollView
            style={sheetStyles.list}
            contentContainerStyle={{ paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {rows.length === 0 ? (
              <Text style={sheetStyles.empty}>暂无可选项</Text>
            ) : (
              rows.map((opt) => {
                const on = opt.value === value;
                return (
                  <Pressable
                    key={opt.value || "__empty"}
                    style={[sheetStyles.row, on && sheetStyles.rowOn]}
                    onPress={() => {
                      onChange(opt.value);
                      onClose();
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[sheetStyles.rowLabel, on && sheetStyles.rowLabelOn]}>
                        {opt.label}
                      </Text>
                      {opt.hint ? (
                        <Text style={sheetStyles.rowHint} numberOfLines={1}>
                          {opt.hint}
                        </Text>
                      ) : null}
                    </View>
                    {on ? <Text style={sheetStyles.check}>✓</Text> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  req: { color: colors.danger },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 52,
  },
  fieldErr: { borderColor: colors.danger },
  value: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "500" },
  placeholder: { color: colors.muted, fontWeight: "400" },
  chevron: {
    color: colors.muted,
    fontSize: 22,
    fontWeight: "300",
    marginLeft: 8,
    lineHeight: 22,
  },
  error: { color: colors.danger, fontSize: 12 },
});

const sheetStyles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15,23,42,0.4)",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  done: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  list: { paddingHorizontal: 12 },
  empty: {
    textAlign: "center",
    color: colors.muted,
    paddingVertical: 32,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  rowOn: { backgroundColor: `${colors.primary}12` },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: "500" },
  rowLabelOn: { color: colors.primary, fontWeight: "700" },
  rowHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  check: { color: colors.primary, fontSize: 18, fontWeight: "700", marginLeft: 8 },
});
