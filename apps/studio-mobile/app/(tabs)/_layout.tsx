import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors } from "../../src/theme";

function TabLabel({
  label,
  focused,
}: {
  label: string;
  focused: boolean;
}) {
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: focused ? "700" : "500",
        color: focused ? colors.primary : colors.muted,
      }}
    >
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontWeight: "700", color: colors.text },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="work-orders"
        options={{
          title: "工单",
          tabBarLabel: ({ focused }) => (
            <TabLabel label="工单" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="bridges"
        options={{
          title: "执行器",
          tabBarLabel: ({ focused }) => (
            <TabLabel label="执行器" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="run-logs"
        options={{
          title: "日志",
          tabBarLabel: ({ focused }) => (
            <TabLabel label="日志" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "更多",
          tabBarLabel: ({ focused }) => (
            <TabLabel label="更多" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
