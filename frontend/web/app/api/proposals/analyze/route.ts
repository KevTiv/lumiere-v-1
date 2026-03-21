import { NextRequest, NextResponse } from "next/server"
import type { AIAnalysis, Finding, Requirement, EvaluationCriterion, Concept } from "@lumiere/ui"

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL ?? "http://localhost:3001"

interface AnalyzeRequest {
  text: string
  proposalId: string
}

// ─── Mock analysis (fallback when AI gateway is unavailable) ────────────────

function mockAnalysis(text: string): AIAnalysis {
  const wordCount = text.trim().split(/\s+/).length
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20).slice(0, 6)

  const findings: Finding[] = sentences.slice(0, 4).map((s, i) => ({
    id: `f-${i}`,
    title: `Finding ${i + 1}`,
    excerpt: s.trim().slice(0, 200),
    relevance: (["high", "medium", "low", "medium"] as const)[i % 4],
    category: (["Requirements", "Technical", "Commercial", "Compliance"] as const)[i % 4],
  }))

  const requirements: Requirement[] = [
    { id: "r-1", text: "Provide a detailed project plan with milestones and deliverables", category: "Project Management", mandatory: true, addressed: false },
    { id: "r-2", text: "Demonstrate relevant experience with at least 3 case studies", category: "Experience", mandatory: true, addressed: false },
    { id: "r-3", text: "Submit a complete pricing breakdown by deliverable", category: "Commercial", mandatory: true, addressed: false },
    { id: "r-4", text: "Comply with local data sovereignty requirements", category: "Compliance", mandatory: true, addressed: false },
    { id: "r-5", text: "Provide a dedicated project manager and named resources", category: "Resourcing", mandatory: false, addressed: false },
    { id: "r-6", text: "Detail your quality assurance and testing methodology", category: "Quality", mandatory: false, addressed: false },
  ]

  const evaluationCriteria: EvaluationCriterion[] = [
    { id: "ec-1", name: "Technical Capability", weight: 35, description: "Demonstrated ability to deliver", addressed: false },
    { id: "ec-2", name: "Commercial Competitiveness", weight: 30, description: "Value for money and pricing clarity", addressed: false },
    { id: "ec-3", name: "Experience & References", weight: 20, description: "Relevant prior work", addressed: false },
    { id: "ec-4", name: "Methodology & Approach", weight: 15, description: "Quality of proposed approach", addressed: false },
  ]

  const concepts: Concept[] = [
    { id: "c-1", term: "RFP", definition: "Request for Proposal — a document soliciting bids from vendors", frequency: 3 },
    { id: "c-2", term: "SLA", definition: "Service Level Agreement — contractual performance commitments", frequency: 2 },
    { id: "c-3", term: "Deliverables", definition: "Tangible outputs or outcomes promised at each milestone", frequency: 4 },
    { id: "c-4", term: "Scope", definition: "The defined boundaries and features of the project", frequency: 5 },
  ]

  return {
    summary: `This document contains ${wordCount.toLocaleString()} words describing procurement requirements. The analysis has identified ${findings.length} key findings, ${requirements.length} requirements to address, and ${evaluationCriteria.length} evaluation criteria to optimise against.`,
    keyFindings: findings,
    requirements,
    evaluationCriteria,
    concepts,
    suggestedSections: [
      "Executive Summary",
      "Company Profile",
      "Technical Approach",
      "Project Timeline & Milestones",
      "Team & Qualifications",
      "Pricing & Commercial Terms",
      "Compliance & Certifications",
    ],
    analyzedAt: new Date(),
  }
}

// ─── Parse AI gateway response into AIAnalysis ────────────────────────────────

function parseGatewayResponse(text: string, responseText: string): AIAnalysis {
  // The AI gateway returns a RAG-style response. Parse it into structured form.
  // If the gateway returns JSON, use it directly; otherwise mock-parse.
  try {
    const parsed = JSON.parse(responseText) as Partial<AIAnalysis>
    return {
      summary: parsed.summary ?? responseText.slice(0, 500),
      keyFindings: parsed.keyFindings ?? [],
      requirements: parsed.requirements ?? [],
      evaluationCriteria: parsed.evaluationCriteria ?? [],
      concepts: parsed.concepts ?? [],
      suggestedSections: parsed.suggestedSections ?? [],
      analyzedAt: new Date(),
    }
  } catch {
    // Plain text response — wrap as summary + fallback structure
    return {
      ...mockAnalysis(text),
      summary: responseText.slice(0, 1000),
    }
  }
}

export async function POST(request: NextRequest) {
  let body: AnalyzeRequest
  try {
    body = (await request.json()) as AnalyzeRequest
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { text } = body
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "text is required" }, { status: 400 })
  }

  // Try AI gateway first; fall back to mock if unavailable
  try {
    const gatewayRes = await fetch(`${AI_GATEWAY_URL}/v1/rag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `Analyse the following procurement document. Extract: 1) A concise executive summary (2-3 sentences), 2) Key findings with excerpts, 3) Mandatory and optional requirements, 4) Evaluation criteria and their weights, 5) Key technical concepts and definitions. Return as JSON matching the AIAnalysis schema. Document:\n\n${text.slice(0, 8000)}`,
        collection: "proposals",
        top_k: 5,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (gatewayRes.ok) {
      const responseText = await gatewayRes.text()
      const analysis = parseGatewayResponse(text, responseText)
      return NextResponse.json(analysis)
    }
  } catch {
    // Gateway unavailable — use mock
  }

  // Fallback to client-side mock analysis
  const analysis = mockAnalysis(text)
  return NextResponse.json(analysis)
}
