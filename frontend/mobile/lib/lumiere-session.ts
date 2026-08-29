/** Bearer token for the Lumiere API. Native tokens stay in SecureStore. */
import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

const SECURE_BEARER_KEY = "lumiere_bearer_token"

export async function getBearerToken(): Promise<string | null> {
  if (Platform.OS !== "web") {
    try {
      return await SecureStore.getItemAsync(SECURE_BEARER_KEY)
    } catch {
      return null
    }
  }
  return AsyncStorage.getItem(SECURE_BEARER_KEY)
}

/** Store API bearer on device (native → SecureStore). Web uses AsyncStorage (dev only). */
export async function setBearerToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(SECURE_BEARER_KEY, token)
    return
  }
  await SecureStore.setItemAsync(SECURE_BEARER_KEY, token)
}
