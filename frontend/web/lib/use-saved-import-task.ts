"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatDecisionAnswer } from "@lumiere/ui/lib/chat-decision-types"
import { apiFetch } from "./api-fetch"
import {
  parseSavedImportTask,
  readSavedImportTask,
  recoverChatImportDecision,
  retryChatImportDecision,
  submitChatImportDecision,
  type ChatImportDecisionPointer,
  type ChatImportScope,
  type ChatImportTask,
} from "./chat-import-task"

export type SavedImportScope = Omit<ChatImportScope, "conversationKey">

type SavedTaskState = {
  key: string
  epoch: number
  task: ChatImportTask | null
  pointer: ChatImportDecisionPointer | null
  busy: boolean
  error: string | null
}

/** Both task reads and decisions retain the server task's original conversation identity. */
export function useSavedImportTask(scope: SavedImportScope, taskId: string) {
  const key = JSON.stringify([
    scope.identity,
    scope.organizationId,
    scope.companyId,
    taskId,
  ])
  const currentScope = useRef({ key, epoch: 0 })
  if (currentScope.current.key !== key)
    currentScope.current = { key, epoch: currentScope.current.epoch + 1 }
  const epoch = currentScope.current.epoch
  const mounted = useRef(false)
  const operation = useRef(0)
  const running = useRef(false)
  const [state, setState] = useState<SavedTaskState>({
    key,
    epoch,
    task: null,
    pointer: null,
    busy: true,
    error: null,
  })
  const isCurrent = useCallback(
    () =>
      mounted.current &&
      currentScope.current.key === key &&
      currentScope.current.epoch === epoch,
    [key, epoch],
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    if (!isCurrent()) return
    const version = ++operation.current
    running.current = true
    const current = () => isCurrent() && operation.current === version
    setState((previous) => ({
      key,
      epoch,
      task:
        previous.key === key && previous.epoch === epoch ? previous.task : null,
      pointer:
        previous.key === key && previous.epoch === epoch
          ? previous.pointer
          : null,
      busy: true,
      error: null,
    }))
    try {
      const task = await readSavedImportTask(apiFetch, scope.companyId, taskId)
      if (!current()) return
      if (!task)
        throw new Error(
          "This saved import is unavailable in the selected company. Check the link and your access.",
        )
      const recovered = await recoverChatImportDecision({
        task,
        scope: { ...scope, conversationKey: task.conversationKey },
        storage: window.localStorage,
        fetcher: apiFetch,
        isCurrent: current,
      })
      if (current())
        setState({
          key,
          epoch,
          task: recovered.task,
          pointer: recovered.pointer,
          busy: false,
          error: null,
        })
    } catch (failure) {
      if (current())
        setState({
          key,
          epoch,
          task: null,
          pointer: null,
          busy: false,
          error:
            failure instanceof Error
              ? failure.message
              : "The saved import could not be checked.",
        })
    } finally {
      if (current()) running.current = false
    }
  }, [
    scope.identity,
    scope.organizationId,
    scope.companyId,
    taskId,
    key,
    epoch,
    isCurrent,
  ])

  useEffect(() => {
    void reload()
  }, [reload])

  const perform = useCallback(
    async (action: "resume" | "retry" | ChatDecisionAnswer) => {
      if (
        !isCurrent() ||
        running.current ||
        state.key !== key ||
        state.epoch !== epoch ||
        !state.task
      )
        throw new Error("Check the saved import before continuing.")
      const task = state.task
      const taskScope = { ...scope, conversationKey: task.conversationKey }
      const version = ++operation.current
      running.current = true
      const current = () => isCurrent() && operation.current === version
      setState((previous) => ({ ...previous, busy: true, error: null }))
      try {
        let saved: ChatImportTask
        if (action === "resume") {
          const response = await apiFetch(
            "/api/import-tasks/" +
              taskId +
              "/resume?companyId=" +
              scope.companyId,
            { method: "POST" },
          )
          if (!current()) return
          if (!response.ok)
            throw new Error(
              "Preparation could not be resumed. Check its saved result before retrying.",
            )
          saved = parseSavedImportTask(
            await response.json(),
            scope.companyId,
            taskId,
          )
        } else if (action === "retry") {
          saved = await retryChatImportDecision({
            taskRequestId: taskId,
            scope: taskScope,
            storage: window.localStorage,
            fetcher: apiFetch,
            isCurrent: current,
          })
        } else {
          if (
            action.optionId !== "prepare_import" &&
            action.optionId !== "inspect_only" &&
            action.optionId !== "other"
          )
            throw new Error("Choose one of the supported file actions.")
          saved = await submitChatImportDecision({
            task,
            answer: { ...action, optionId: action.optionId },
            scope: taskScope,
            storage: window.localStorage,
            fetcher: apiFetch,
            isCurrent: current,
          })
        }
        if (current())
          setState({
            key,
            epoch,
            task: saved,
            pointer: null,
            busy: false,
            error: null,
          })
      } catch (failure) {
        // An uncertain response cannot leave interactive stale source or approval cards behind.
        if (current())
          setState({
            key,
            epoch,
            task: null,
            pointer: null,
            busy: false,
            error:
              failure instanceof Error
                ? failure.message
                : "The saved action could not be checked.",
          })
        throw failure
      } finally {
        if (current()) running.current = false
      }
    },
    [
      scope.identity,
      scope.organizationId,
      scope.companyId,
      taskId,
      state,
      key,
      epoch,
      isCurrent,
    ],
  )

  const visible = state.key === key && state.epoch === epoch ? state : null
  return {
    task: visible?.task ?? null,
    pointer: visible?.pointer ?? null,
    busy: visible?.busy ?? true,
    error: visible?.error ?? null,
    reload,
    answer: (answer: ChatDecisionAnswer) => perform(answer),
    resume: () => perform("resume"),
    retryDecision: () => perform("retry"),
  }
}
