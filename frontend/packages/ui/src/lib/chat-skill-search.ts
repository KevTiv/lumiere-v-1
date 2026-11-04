import type { ChatSkill } from "./ai-chat-types"

/** Only a slash token at the caret opens the picker, never a URL or a date. */
export function slashSkillToken(input: string, caret: number) {
  const match = /(^|\s)\/([^\s/]*)$/.exec(input.slice(0, caret))
  if (!match) return null
  const start = match.index + match[1]!.length
  const tail = /^[^\s/]*/.exec(input.slice(caret))?.[0] ?? ""
  return { start, end: caret + tail.length, query: match[2]! }
}

export function matchingChatSkills(skills: readonly ChatSkill[], query: string) {
  const normalized = query.toLocaleLowerCase().replace(/[_-]/g, " ")
  return skills.filter(skill => [skill.id, skill.label, skill.description, ...(skill.keywords ?? [])]
    .some(value => value?.toLocaleLowerCase().replace(/[_-]/g, " ").includes(normalized)))
}
