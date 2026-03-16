"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Progress } from "@/components/ui/progress"
import { useRBAC } from "@/lib/rbac-context"
import {
  X,
  Mic,
  MicOff,
  Send,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Star,
  Smile,
  Meh,
  Frown,
  Cloud,
  Trophy,
  Mountain,
  Lightbulb,
  Users,
  Target,
  MessageCircle,
  Sparkles,
  FileText,
  Clock,
  TrendingUp,
  CheckCircle,
  Circle,
  Flame,
  BookOpen,
  History,
  PenLine,
  Wand2,
} from "lucide-react"
import {
  journalConfigs,
  defaultJournalConfig,
  moodOptions,
  categoryLabels,
  sampleJournalEntries,
  type JournalEntry,
  type JournalPrompt,
  type JournalMood,
  type JournalResponse,
  type JournalConfig,
  type JournalCategory,
} from "@/lib/journal-types"

interface JournalPanelProps {
  open: boolean
  onClose: () => void
}

const moodIcons: Record<JournalMood, React.ReactNode> = {
  great: <Star className="h-5 w-5" />,
  good: <Smile className="h-5 w-5" />,
  neutral: <Meh className="h-5 w-5" />,
  challenging: <Frown className="h-5 w-5" />,
  difficult: <Cloud className="h-5 w-5" />,
}

const categoryIcons: Record<JournalCategory, React.ReactNode> = {
  accomplishment: <Trophy className="h-4 w-4" />,
  challenge: <Mountain className="h-4 w-4" />,
  learning: <Lightbulb className="h-4 w-4" />,
  collaboration: <Users className="h-4 w-4" />,
  goal: <Target className="h-4 w-4" />,
  feedback: <MessageCircle className="h-4 w-4" />,
  idea: <Sparkles className="h-4 w-4" />,
  other: <FileText className="h-4 w-4" />,
}

export function JournalPanel({ open, onClose }: JournalPanelProps) {
  const { currentUser, roles } = useRBAC()
  const [view, setView] = useState<"entry" | "history" | "insights">("entry")
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0)
  const [selectedMood, setSelectedMood] = useState<JournalMood | null>(null)
  const [responses, setResponses] = useState<Map<string, string>>(new Map())
  const [currentInput, setCurrentInput] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [entries, setEntries] = useState<JournalEntry[]>(sampleJournalEntries)
  const [predictiveText, setPredictiveText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  // Get role-based config
  const userRoleId = currentUser?.roles[0] || "default"
  const config: JournalConfig = journalConfigs[userRoleId] || defaultJournalConfig
  const prompts = config.dailyPrompts
  const currentPrompt = prompts[currentPromptIndex]

  // Calculate stats
  const stats = {
    totalEntries: entries.length,
    currentStreak: 2,
    completionRate: Math.round((responses.size / prompts.length) * 100),
  }

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== "undefined" && "webkitSpeechRecognition" in window) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognitionClass = (window as any).webkitSpeechRecognition
      recognitionRef.current = new SpeechRecognitionClass()
      recognitionRef.current.continuous = true
      recognitionRef.current.interimResults = true

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognitionRef.current.onresult = (event: any) => {
        let transcript = ""
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        setCurrentInput((prev) => prev + " " + transcript)
      }

      recognitionRef.current.onerror = () => {
        setIsRecording(false)
      }

      recognitionRef.current.onend = () => {
        setIsRecording(false)
      }
    }
  }, [])

  // Predictive text based on AI suggestions
  useEffect(() => {
    if (currentInput.length > 3 && currentPrompt?.aiSuggestions) {
      const input = currentInput.toLowerCase()
      const match = currentPrompt.aiSuggestions.find((s) =>
        s.toLowerCase().startsWith(input)
      )
      if (match && match.toLowerCase() !== input) {
        setPredictiveText(match)
      } else {
        setPredictiveText("")
      }
    } else {
      setPredictiveText("")
    }
  }, [currentInput, currentPrompt])

  const toggleRecording = useCallback(() => {
    if (!recognitionRef.current) return

    if (isRecording) {
      recognitionRef.current.stop()
      setIsRecording(false)
    } else {
      recognitionRef.current.start()
      setIsRecording(true)
    }
  }, [isRecording])

  const handleSuggestionClick = (suggestion: string) => {
    setCurrentInput(suggestion)
    setShowSuggestions(false)
    textareaRef.current?.focus()
  }

  const handleAcceptPredictive = () => {
    if (predictiveText) {
      setCurrentInput(predictiveText)
      setPredictiveText("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" && predictiveText) {
      e.preventDefault()
      handleAcceptPredictive()
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmitResponse()
    }
  }

  const handleSubmitResponse = () => {
    if (!currentInput.trim() || !currentPrompt) return

    const newResponses = new Map(responses)
    newResponses.set(currentPrompt.id, currentInput.trim())
    setResponses(newResponses)
    setCurrentInput("")
    setPredictiveText("")

    // Auto-advance to next prompt
    if (currentPromptIndex < prompts.length - 1) {
      setCurrentPromptIndex(currentPromptIndex + 1)
    }
  }

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const handleSaveEntry = () => {
    if (!selectedMood || responses.size === 0) return

    const newEntry: JournalEntry = {
      id: `entry-${Date.now()}`,
      userId: currentUser?.id || "unknown",
      date: new Date().toISOString().split("T")[0],
      mood: selectedMood,
      responses: Array.from(responses.entries()).map(([promptId, response]) => {
        const prompt = prompts.find((p) => p.id === promptId)
        return {
          promptId,
          prompt: prompt?.text || "",
          response,
          category: prompt?.category || "other",
          timestamp: new Date().toISOString(),
        }
      }),
      tags: selectedTags,
      isComplete: responses.size === prompts.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    setEntries([newEntry, ...entries])
    // Reset form
    setResponses(new Map())
    setSelectedMood(null)
    setSelectedTags([])
    setCurrentPromptIndex(0)
    setView("history")
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl border-border/50">
        {/* Header */}
        <CardHeader className="flex flex-row items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">Journal de Bord</CardTitle>
              <p className="text-xs text-muted-foreground">
                {config.roleName} - {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View switcher */}
            <div className="flex items-center rounded-lg bg-muted p-1">
              <Button
                variant={view === "entry" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView("entry")}
                className="h-7 px-3 text-xs"
              >
                <PenLine className="h-3.5 w-3.5 mr-1.5" />
                Write
              </Button>
              <Button
                variant={view === "history" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView("history")}
                className="h-7 px-3 text-xs"
              >
                <History className="h-3.5 w-3.5 mr-1.5" />
                History
              </Button>
              <Button
                variant={view === "insights" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView("insights")}
                className="h-7 px-3 text-xs"
              >
                <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                Insights
              </Button>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden p-0">
          {view === "entry" && (
            <div className="flex flex-col h-full">
              {/* Mood selector */}
              {!selectedMood ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <h3 className="text-lg font-medium mb-2">How was your day?</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    Start by selecting how you&apos;re feeling
                  </p>
                  <div className="flex items-center gap-3">
                    {moodOptions.map((mood) => (
                      <button
                        key={mood.value}
                        onClick={() => setSelectedMood(mood.value)}
                        className={cn(
                          "flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-transparent transition-all",
                          "hover:border-primary/30 hover:bg-muted/50",
                          mood.color
                        )}
                      >
                        {moodIcons[mood.value]}
                        <span className="text-xs font-medium text-foreground">{mood.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* Progress bar */}
                  <div className="px-6 py-3 border-b border-border bg-muted/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">
                        Question {currentPromptIndex + 1} of {prompts.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <Flame className="h-3.5 w-3.5 text-orange-500" />
                        <span className="text-xs font-medium">{stats.currentStreak} day streak</span>
                      </div>
                    </div>
                    <Progress value={(responses.size / prompts.length) * 100} className="h-1.5" />
                  </div>

                  {/* Prompt area */}
                  <ScrollArea className="flex-1">
                    <div className="p-6">
                      {/* Current prompt */}
                      <div className="mb-6">
                        <div className="flex items-start gap-3 mb-4">
                          <div className={cn("p-2 rounded-lg bg-muted", categoryLabels[currentPrompt.category].color)}>
                            {categoryIcons[currentPrompt.category]}
                          </div>
                          <div className="flex-1">
                            <Badge variant="outline" className="mb-2 text-[10px]">
                              {categoryLabels[currentPrompt.category].label}
                            </Badge>
                            <h4 className="text-base font-medium leading-relaxed">
                              {currentPrompt.text}
                            </h4>
                          </div>
                        </div>

                        {/* AI suggestions */}
                        {config.aiAssistEnabled && currentPrompt.aiSuggestions && (
                          <div className="mb-4">
                            <button
                              onClick={() => setShowSuggestions(!showSuggestions)}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Wand2 className="h-3 w-3" />
                              <span>AI suggestions</span>
                              <ChevronRight className={cn("h-3 w-3 transition-transform", showSuggestions && "rotate-90")} />
                            </button>
                            {showSuggestions && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {currentPrompt.aiSuggestions.map((suggestion, i) => (
                                  <button
                                    key={i}
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    className="px-3 py-1.5 text-xs rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                  >
                                    {suggestion}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Input area with predictive text */}
                        <div className="relative">
                          <div className="relative">
                            <Textarea
                              ref={textareaRef}
                              value={currentInput}
                              onChange={(e) => setCurrentInput(e.target.value)}
                              onKeyDown={handleKeyDown}
                              placeholder="Type your response... (Tab to accept suggestion, Enter to submit)"
                              rows={4}
                              className="pr-24 resize-none"
                            />
                            {/* Predictive text overlay */}
                            {predictiveText && (
                              <div className="absolute inset-0 pointer-events-none px-3 py-2 text-sm">
                                <span className="invisible">{currentInput}</span>
                                <span className="text-muted-foreground/50">
                                  {predictiveText.slice(currentInput.length)}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="absolute right-2 bottom-2 flex items-center gap-1">
                            {config.voiceInputEnabled && (
                              <Button
                                variant={isRecording ? "destructive" : "ghost"}
                                size="icon"
                                onClick={toggleRecording}
                                className="h-8 w-8"
                              >
                                {isRecording ? (
                                  <MicOff className="h-4 w-4" />
                                ) : (
                                  <Mic className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                            <Button
                              size="icon"
                              onClick={handleSubmitResponse}
                              disabled={!currentInput.trim()}
                              className="h-8 w-8"
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {predictiveText && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Press Tab to accept: &quot;{predictiveText}&quot;
                          </p>
                        )}
                      </div>

                      {/* Previous responses */}
                      {responses.size > 0 && (
                        <div className="space-y-3 mb-6">
                          <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Your responses
                          </h5>
                          {Array.from(responses.entries()).map(([promptId, response]) => {
                            const prompt = prompts.find((p) => p.id === promptId)
                            if (!prompt) return null
                            return (
                              <div key={promptId} className="p-3 rounded-lg bg-muted/50 border border-border/50">
                                <div className="flex items-center gap-2 mb-1">
                                  <CheckCircle className="h-3 w-3 text-green-500" />
                                  <span className="text-xs text-muted-foreground">{prompt.text}</span>
                                </div>
                                <p className="text-sm pl-5">{response}</p>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Tags */}
                      <div className="mb-4">
                        <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                          Tags
                        </h5>
                        <div className="flex flex-wrap gap-2">
                          {config.suggestedTags.map((tag) => (
                            <button
                              key={tag}
                              onClick={() => handleTagToggle(tag)}
                              className={cn(
                                "px-2.5 py-1 text-xs rounded-full border transition-colors",
                                selectedTags.includes(tag)
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border hover:border-primary/50"
                              )}
                            >
                              #{tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </ScrollArea>

                  {/* Navigation and save */}
                  <div className="px-6 py-4 border-t border-border bg-card flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPromptIndex(Math.max(0, currentPromptIndex - 1))}
                        disabled={currentPromptIndex === 0}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPromptIndex(Math.min(prompts.length - 1, currentPromptIndex + 1))}
                        disabled={currentPromptIndex === prompts.length - 1}
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedMood(null)}
                      >
                        Change mood
                      </Button>
                      <Button
                        onClick={handleSaveEntry}
                        disabled={responses.size === 0}
                        className="gap-2"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Save Entry
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {view === "history" && (
            <ScrollArea className="h-full">
              <div className="p-6 space-y-4">
                {entries.length === 0 ? (
                  <div className="text-center py-12">
                    <BookOpen className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                    <p className="text-muted-foreground">No journal entries yet</p>
                    <Button variant="outline" className="mt-4" onClick={() => setView("entry")}>
                      Write your first entry
                    </Button>
                  </div>
                ) : (
                  entries.map((entry) => (
                    <Card key={entry.id} className="border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">
                              {new Date(entry.date).toLocaleDateString("en-US", {
                                weekday: "long",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={moodOptions.find((m) => m.value === entry.mood)?.color}>
                              {moodIcons[entry.mood]}
                            </span>
                            {entry.isComplete ? (
                              <Badge variant="default" className="text-[10px]">Complete</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">Partial</Badge>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          {entry.responses.slice(0, 2).map((response, i) => (
                            <div key={i} className="text-sm">
                              <span className="text-muted-foreground">{response.prompt}</span>
                              <p className="mt-0.5">{response.response}</p>
                            </div>
                          ))}
                          {entry.responses.length > 2 && (
                            <p className="text-xs text-muted-foreground">
                              +{entry.responses.length - 2} more responses
                            </p>
                          )}
                        </div>
                        {entry.tags.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-3">
                            {entry.tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px]">
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          )}

          {view === "insights" && (
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                {/* Stats overview */}
                <div className="grid grid-cols-3 gap-4">
                  <Card className="border-border/50">
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-primary">{entries.length}</div>
                      <div className="text-xs text-muted-foreground">Total Entries</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50">
                    <CardContent className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Flame className="h-5 w-5 text-orange-500" />
                        <span className="text-2xl font-bold">2</span>
                      </div>
                      <div className="text-xs text-muted-foreground">Day Streak</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50">
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-green-500">85%</div>
                      <div className="text-xs text-muted-foreground">Completion Rate</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Mood distribution */}
                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Mood Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {moodOptions.map((mood) => {
                        const count = entries.filter((e) => e.mood === mood.value).length
                        const percent = entries.length > 0 ? (count / entries.length) * 100 : 0
                        return (
                          <div key={mood.value} className="flex items-center gap-3">
                            <span className={cn("w-20 text-xs flex items-center gap-1.5", mood.color)}>
                              {moodIcons[mood.value]}
                              {mood.label}
                            </span>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", mood.color.replace("text-", "bg-"))}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-8">{count}</span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Common themes */}
                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Common Themes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {Array.from(new Set(entries.flatMap((e) => e.tags))).map((tag) => {
                        const count = entries.filter((e) => e.tags.includes(tag)).length
                        return (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            #{tag} ({count})
                          </Badge>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* AI insight placeholder */}
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Sparkles className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-sm font-medium mb-1">AI Insight</h4>
                        <p className="text-xs text-muted-foreground">
                          Based on your recent entries, you&apos;ve been most productive on days when you start with customer outreach. 
                          Consider scheduling your most important calls in the morning to maintain this momentum.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
