/** Folder ancestry is checked by HTTP reads, so visible workspaces refresh without raw row subscriptions. */
export const documentReadRefresh = {
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
  // A recently cached row still needs current access checks when the user returns.
  refetchOnWindowFocus: "always",
} as const
