import React from "react"
import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { i18n } from "@lumiere/i18n"
import { WorkLoadedCount } from "./work-loaded-count"

Object.assign(globalThis, { React })

test("My work only labels counts as loaded after a successful read", () => {
  const html = (count: number, isError: boolean, isPending: boolean) => renderToStaticMarkup(
    <WorkLoadedCount count={count} isError={isError} isPending={isPending} />,
  )
  assert.ok(html(0, false, false).includes(i18n.t("workBoard.loaded", { count: 0 })))
  assert.ok(html(73, false, false).includes(i18n.t("workBoard.loaded", { count: 73 })))
  for (const count of [0, 73]) {
    const loading = html(count, false, true)
    assert.ok(loading.includes(i18n.t("workBoard.loading")))
    assert.ok(!loading.includes(i18n.t("workBoard.loaded", { count })))
    const failed = html(count, true, false)
    assert.ok(failed.includes(i18n.t("workBoard.readFailed")))
    assert.ok(!failed.includes(i18n.t("workBoard.loaded", { count })))
  }
})
