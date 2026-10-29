import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { LumiereApiProvider } from '@lumiere/api-client';
import { I18nProvider, useTranslation } from '@lumiere/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { mobileApi } from '@/lib/lumiere-api';

const queryClient = new QueryClient();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();

  return (
    <I18nProvider>
    <LumiereApiProvider client={mobileApi}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: t('mobile.navigation.modal') }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </QueryClientProvider>
    </LumiereApiProvider>
    </I18nProvider>
  );
}
