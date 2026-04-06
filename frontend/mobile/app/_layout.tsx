import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { LumiereApiProvider } from '@lumiere/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { mobileApi } from '@/lib/lumiere-api';
import { initStdb } from '../lib/stdb';

const queryClient = new QueryClient();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [stdbReady, setStdbReady] = useState(false);
  const [stdbError, setStdbError] = useState<string | null>(null);
  useEffect(() => {
    initStdb()
      .then(() => setStdbReady(true))
      .catch((e) => setStdbError(String(e)));
  }, []);

  if (stdbError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>SpacetimeDB error: {stdbError}</Text>
      </View>
    );
  }

  return (
    <LumiereApiProvider client={mobileApi}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </QueryClientProvider>
    </LumiereApiProvider>
  );
}
