import fs from "node:fs"
import path from "node:path"

import { test as setup } from "@playwright/test"

import { AUTH_STORAGE_PATH, signIn } from "./helpers"

setup("authenticate", async ({ page }) => {
  await signIn(page)

  fs.mkdirSync(path.dirname(AUTH_STORAGE_PATH), { recursive: true })
  await page.context().storageState({ path: AUTH_STORAGE_PATH })
})
