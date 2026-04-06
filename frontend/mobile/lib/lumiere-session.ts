/**
 * Bearer token for Next.js `/api/*` (same value as web SpacetimeDB session cookie).
 * Native: optional override in SecureStore; falls back to AsyncStorage `lumiere_stdb_token` from {@link initStdb}.
 */
import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

const SECURE_BEARER_KEY = "lumiere_bearer_token"
const ASYNC_STDB_TOKEN_KEY = "lumiere_stdb_token"

export async function getBearerToken(): Promise<string | null> {
  if (Platform.OS !== "web") {
    try {
      const secured = await SecureStore.getItemAsync(SECURE_BEARER_KEY)
      if (secured) return secured
    } catch {
      // Missing capability / simulator edge cases
    }
  }
  return AsyncStorage.getItem(ASYNC_STDB_TOKEN_KEY)
}

/** Store API bearer on device (native → SecureStore). Web uses AsyncStorage (dev only). */
export async function setBearerToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(ASYNC_STDB_TOKEN_KEY, token)
    return
  }
  await SecureStore.setItemAsync(SECURE_BEARER_KEY, token)
}
