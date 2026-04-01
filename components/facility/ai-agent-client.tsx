"use client"

import { useState, useRef, useEffect, type FormEvent } from "react"
import {
  Lock,
  Bot,
  RefreshCw,
  Upload,
  Search,
  MessageSquare,
  ClipboardList,
  Send,
  Loader2,
  Sparkles,
  FileText,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  PieChart,
  BarChart3,
  History,
  Trash2,
  Download,
  Filter,
  ChevronRight,
  Zap,
  Shield,
  Clock,
  Plus,
  MoreHorizontal,
  Copy,
  CheckCircle2,
} from "lucide-react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FACILITY_SUGGESTED_QUESTIONS = [
  {
    icon: FileText,
    label: "Contract Performance",
    question: "How are our top contracts performing this quarter?",
  },
  {
    icon: TrendingUp,
    label: "Rebate Analysis",
    question:
      "What is our total earned rebate this year and how close are we to hitting the next tier?",
  },
  {
    icon: AlertTriangle,
    label: "Alerts Summary",
    question: "What are the critical alerts I should address today?",
  },
  {
    icon: DollarSign,
    label: "Cost Savings",
    question:
      "Where are our biggest opportunities to save money on contracts?",
  },
  {
    icon: PieChart,
    label: "Market Share",
    question:
      "What does our market share look like across product categories?",
  },
  {
    icon: BarChart3,
    label: "Surgeon Metrics",
    question: "Which surgeons have the best spend efficiency scores?",
  },
]

const REPORT_TYPES = [
  {
    id: "contract-summary",
    label: "Contract Summary",
    description: "Overview of all active contracts with key metrics",
    icon: FileText,
  },
  {
    id: "rebate-forecast",
    label: "Rebate Forecast",
    description: "Projected rebate earnings based on current trends",
    icon: TrendingUp,
  },
  {
    id: "spend-analysis",
    label: "Spend Analysis",
    description: "Detailed breakdown of spending by category and vendor",
    icon: DollarSign,
  },
  {
    id: "compliance-audit",
    label: "Compliance Audit",
    description: "Contract compliance status and flagged items",
    icon: Shield,
  },
  {
    id: "market-share-report",
    label: "Market Share Report",
    description: "Market share across product categories and vendors",
    icon: PieChart,
  },
  {
    id: "cost-optimization",
    label: "Cost Optimization",
    description: "Actionable recommendations for reducing costs",
    icon: Zap,
  },
]

const SAMPLE_DOCUMENTS = [
  {
    id: "1",
    name: "Stryker Joint Replacement Agreement",
    type: "Contract",
    uploadedAt: "2025-12-15",
    pages: 42,
    status: "indexed" as const,
  },
  {
    id: "2",
    name: "Medtronic Spine Portfolio Terms",
    type: "Contract",
    uploadedAt: "2025-11-20",
    pages: 38,
    status: "indexed" as const,
  },
  {
    id: "3",
    name: "J&J Trauma Pricing Addendum",
    type: "Amendment",
    uploadedAt: "2026-01-05",
    pages: 12,
    status: "indexed" as const,
  },
  {
    id: "4",
    name: "Zimmer Biomet Knee Systems SOW",
    type: "SOW",
    uploadedAt: "2026-02-10",
    pages: 24,
    status: "processing" as const,
  },
  {
    id: "5",
    name: "Smith+Nephew Sports Med Agreement",
    type: "Contract",
    uploadedAt: "2026-03-01",
    pages: 35,
    status: "indexed" as const,
  },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ChatMessageBubbleProps {
  role: string
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  isLoading?: boolean
  onCopy?: (text: string) => void
}

function ChatMessageBubble({ role, parts, isLoading, onCopy }: ChatMessageBubbleProps) {
  const isUser = role === "user"
  const textContent = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")

  if (isLoading && !isUser) {
    return (
      <div className="flex gap-3 justify-start">
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary/10">
            <Bot className="size-4 text-primary" />
          </AvatarFallback>
        </Avatar>
        <div className="rounded-lg bg-muted px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex gap-1">
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
            </span>
            <span className="text-sm text-muted-foreground">Analyzing your data...</span>
          </div>
        </div>
      </div>
    )
  }

  if (!textContent) return null

  return (
    <div className={`group flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary/10">
            <Bot className="size-4 text-primary" />
          </AvatarFallback>
        </Avatar>
      )}
      <div className="flex flex-col gap-1 max-w-[80%]">
        <div
          className={`rounded-lg px-4 py-2.5 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          <div className="whitespace-pre-wrap leading-relaxed">{textContent}</div>
        </div>
        {!isUser && onCopy && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onCopy(textContent)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy response</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
      {isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-secondary">
            <MessageSquare className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface AIAgentClientProps {
  facilityId: string
  enabled: boolean
}

export function AIAgentClient({ facilityId, enabled }: AIAgentClientProps) {
  const [activeTab, setActiveTab] = useState("chat")
  const [docSearch, setDocSearch] = useState("")
  const [docFilter, setDocFilter] = useState("all")
  const [reportType, setReportType] = useState("")
  const [reportPrompt, setReportPrompt] = useState("")
  const [reportGenerating, setReportGenerating] = useState(false)
  const [reportGenerated, setReportGenerated] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [chatInput, setChatInput] = useState("")

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { portalType: "facility" },
    }),
  })

  const isLoading = status === "streaming" || status === "submitted"
  const isEmpty = messages.length === 0

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current && activeTab === "chat") {
      inputRef.current.focus()
    }
  }, [activeTab])

  function onChatSubmit(e: FormEvent) {
    e.preventDefault()
    if (!chatInput.trim() || isLoading) return
    sendMessage({ text: chatInput })
    setChatInput("")
  }

  function handleSuggestion(question: string) {
    if (isLoading) return
    sendMessage({ text: question })
  }

  function handleReset() {
    setMessages([])
    setChatInput("")
  }

  function handleCopy(text: string, id?: string) {
    navigator.clipboard.writeText(text)
    if (id) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    }
  }

  function handleGenerateReport() {
    if (!reportType && !reportPrompt.trim()) return
    setReportGenerating(true)
    setReportGenerated(false)
    // Simulate report generation delay
    setTimeout(() => {
      setReportGenerating(false)
      setReportGenerated(true)
    }, 3000)
  }

  const filteredDocs = SAMPLE_DOCUMENTS.filter((doc) => {
    const matchesSearch =
      !docSearch ||
      doc.name.toLowerCase().includes(docSearch.toLowerCase())
    const matchesFilter = docFilter === "all" || doc.type === docFilter
    return matchesSearch && matchesFilter
  })

  // ------ Disabled state ------
  if (!enabled) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Assistant</h1>
            <p className="text-sm text-muted-foreground">
              AI-powered contract analysis
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="size-8 text-muted-foreground" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">AI Agent is Disabled</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                The AI assistant can analyze contracts, calculate rebates,
                review surgeon performance, and help identify cost-saving
                opportunities. Enable it in your facility settings to get
                started.
              </p>
            </div>
            <Button variant="outline" className="mt-2">
              Go to Settings
            </Button>
          </CardContent>
        </Card>

        {/* Show capabilities even when disabled */}
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: MessageSquare,
              title: "Chat with AI",
              desc: "Ask questions about your contracts, rebates, and spending in natural language",
            },
            {
              icon: Search,
              title: "Document Search",
              desc: "Search across all indexed contract documents for specific terms and clauses",
            },
            {
              icon: ClipboardList,
              title: "AI Reports",
              desc: "Generate professional reports with AI-powered insights and recommendations",
            },
          ].map((cap) => (
            <Card key={cap.title} className="opacity-60">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-2">
                  <cap.icon className="h-5 w-5 text-muted-foreground" />
                  <h4 className="font-medium">{cap.title}</h4>
                </div>
                <p className="text-sm text-muted-foreground">{cap.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // ------ Enabled state ------
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Chat with AI, search documents, or generate reports
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "chat" && !isEmpty && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <Plus className="mr-2 h-4 w-4" />
              New Chat
            </Button>
          )}
          {activeTab === "documents" && (
            <Button variant="outline" size="sm">
              <Upload className="mr-2 h-4 w-4" />
              Upload Document
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="w-fit mb-4">
          <TabsTrigger value="chat" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <Search className="h-4 w-4" />
            Document Search
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Generate Reports
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* Chat Tab                                                         */}
        {/* ================================================================ */}
        <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
          <Card className="flex flex-1 flex-col overflow-hidden">
            {/* Chat message area */}
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              {isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full py-12">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">
                    How can I help you today?
                  </h2>
                  <p className="text-muted-foreground text-center max-w-md mb-8">
                    I can analyze your contracts, calculate rebates, review
                    surgeon performance, and help identify cost-saving
                    opportunities.
                  </p>

                  {/* Suggested questions grid */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 w-full max-w-3xl">
                    {FACILITY_SUGGESTED_QUESTIONS.map((sq) => (
                      <Button
                        key={sq.label}
                        variant="outline"
                        className="h-auto p-4 flex flex-col items-start gap-2 text-left"
                        onClick={() => handleSuggestion(sq.question)}
                      >
                        <div className="flex items-center gap-2">
                          <sq.icon className="h-4 w-4 text-primary" />
                          <span className="font-medium">{sq.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground line-clamp-2">
                          {sq.question}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((m) => (
                    <ChatMessageBubble
                      key={m.id}
                      role={m.role}
                      parts={m.parts}
                      onCopy={(text) => handleCopy(text, m.id)}
                    />
                  ))}
                  {isLoading && (
                    <ChatMessageBubble
                      role="assistant"
                      parts={[]}
                      isLoading
                    />
                  )}
                </div>
              )}
            </ScrollArea>

            <Separator />

            {/* Input area */}
            <div className="p-4">
              <form onSubmit={onChatSubmit} className="flex gap-2 items-end">
                <Textarea
                  ref={inputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      onChatSubmit(e)
                    }
                  }}
                  placeholder="Ask about contracts, rebates, surgeon performance..."
                  disabled={isLoading}
                  className="flex-1 min-h-[44px] max-h-[120px] resize-none"
                  rows={1}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={isLoading || !chatInput.trim()}
                  className="shrink-0 h-[44px] w-[44px]"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                AI responses are based on your contract data and may require
                verification
              </p>
            </div>
          </Card>

          {/* Topic badges below the chat card */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">Contract Analysis</Badge>
            <Badge variant="secondary">Rebate Calculations</Badge>
            <Badge variant="secondary">Market Share</Badge>
            <Badge variant="secondary">Surgeon Metrics</Badge>
            <Badge variant="secondary">Alerts Review</Badge>
            <Badge variant="secondary">Cost Optimization</Badge>
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* Documents Tab                                                    */}
        {/* ================================================================ */}
        <TabsContent value="documents" className="flex-1 overflow-auto mt-0">
          <div className="space-y-4">
            {/* Search and filter bar */}
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={docSearch}
                        onChange={(e) => setDocSearch(e.target.value)}
                        placeholder="Search contract terms, clauses, pricing..."
                        className="pl-9 pr-4"
                      />
                    </div>
                    <Select value={docFilter} onValueChange={setDocFilter}>
                      <SelectTrigger className="w-[140px]">
                        <Filter className="mr-2 h-4 w-4" />
                        <SelectValue placeholder="All types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="Contract">Contracts</SelectItem>
                        <SelectItem value="Amendment">Amendments</SelectItem>
                        <SelectItem value="SOW">SOW</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button>
                      <Search className="mr-2 h-4 w-4" />
                      Search
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Document list */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Indexed Documents</CardTitle>
                  <Badge variant="secondary">
                    {filteredDocs.length} document{filteredDocs.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
                <CardDescription>
                  Documents are indexed for AI-powered search and analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                {filteredDocs.length === 0 ? (
                  <div className="text-center py-12">
                    <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">
                      No Documents Found
                    </h3>
                    <p className="text-muted-foreground">
                      {docSearch
                        ? "Try a different search term"
                        : "Upload documents to get started"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{doc.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-xs">
                                {doc.type}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {doc.pages} pages
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Uploaded{" "}
                                {new Date(doc.uploadedAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {doc.status === "processing" ? (
                            <Badge variant="secondary" className="gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Processing
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="gap-1 bg-green-500/10 text-green-700 dark:text-green-400"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Indexed
                            </Badge>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>
                                <Search className="mr-2 h-4 w-4" />
                                Search in document
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <MessageSquare className="mr-2 h-4 w-4" />
                                Ask AI about this
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem>
                                <Download className="mr-2 h-4 w-4" />
                                Download
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tips card */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h4 className="text-sm font-medium mb-1">
                      AI-Powered Search Tips
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 shrink-0" />
                        Search for specific pricing terms like &quot;unit price&quot; or &quot;rebate percentage&quot;
                      </li>
                      <li className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 shrink-0" />
                        Find compliance clauses by searching &quot;termination&quot; or &quot;renewal&quot;
                      </li>
                      <li className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 shrink-0" />
                        Use natural language like &quot;What are the volume discount tiers?&quot;
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* Reports Tab                                                      */}
        {/* ================================================================ */}
        <TabsContent value="reports" className="flex-1 overflow-auto mt-0">
          <div className="grid gap-4 lg:grid-cols-5">
            {/* Report configuration panel */}
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ClipboardList className="h-5 w-5 text-primary" />
                    Report Configuration
                  </CardTitle>
                  <CardDescription>
                    Choose a report type or describe a custom report
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Report Type</label>
                    <Select value={reportType} onValueChange={setReportType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a report type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {REPORT_TYPES.map((rt) => (
                          <SelectItem key={rt.id} value={rt.id}>
                            <div className="flex items-center gap-2">
                              <rt.icon className="h-4 w-4" />
                              {rt.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Additional Instructions
                    </label>
                    <Textarea
                      value={reportPrompt}
                      onChange={(e) => setReportPrompt(e.target.value)}
                      placeholder="Describe specific data points, time periods, or formatting preferences..."
                      rows={4}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={handleGenerateReport}
                    disabled={
                      reportGenerating ||
                      (!reportType && !reportPrompt.trim())
                    }
                  >
                    {reportGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating Report...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generate Report
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Quick report types */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">
                    Quick Reports
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    {REPORT_TYPES.map((rt) => (
                      <Button
                        key={rt.id}
                        variant="outline"
                        size="sm"
                        className="h-auto p-3 flex flex-col items-start gap-1 text-left"
                        onClick={() => {
                          setReportType(rt.id)
                          setReportGenerated(false)
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <rt.icon className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-medium">
                            {rt.label}
                          </span>
                        </div>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Report preview panel */}
            <div className="lg:col-span-3">
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Report Preview</CardTitle>
                    {reportGenerated && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Copy className="mr-2 h-4 w-4" />
                          Copy
                        </Button>
                        <Button variant="outline" size="sm">
                          <Download className="mr-2 h-4 w-4" />
                          Export PDF
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {reportGenerating ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                      <h3 className="text-lg font-medium mb-2">
                        Generating Your Report
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-md">
                        AI is analyzing your contract data and compiling the
                        report. This may take a moment...
                      </p>
                    </div>
                  ) : reportGenerated ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <div className="rounded-lg border p-6 space-y-4">
                        <div className="flex items-center justify-between border-b pb-4">
                          <div>
                            <h3 className="text-lg font-semibold m-0">
                              {REPORT_TYPES.find((r) => r.id === reportType)
                                ?.label ?? "Custom Report"}
                            </h3>
                            <p className="text-xs text-muted-foreground mt-1">
                              Generated on{" "}
                              {new Date().toLocaleDateString("en-US", {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              })}
                            </p>
                          </div>
                          <Badge>AI Generated</Badge>
                        </div>
                        <div className="space-y-3 text-sm text-muted-foreground">
                          <p>
                            <strong className="text-foreground">
                              Executive Summary
                            </strong>
                          </p>
                          <p>
                            This report provides an AI-generated overview based
                            on your current contract portfolio. Review the data
                            points and consult with your team before making
                            decisions based on these insights.
                          </p>
                          <p>
                            <strong className="text-foreground">
                              Key Findings
                            </strong>
                          </p>
                          <ul className="list-disc pl-4 space-y-1">
                            <li>
                              Full report data will be populated from your live
                              contract analytics
                            </li>
                            <li>
                              Connect this to the AI chat endpoint for dynamic
                              report generation
                            </li>
                            <li>
                              Export options include PDF and CSV formats
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                      <ClipboardList className="h-12 w-12 mb-4 opacity-50" />
                      <h3 className="text-lg font-medium mb-2">
                        No Report Generated Yet
                      </h3>
                      <p className="text-sm max-w-md">
                        Select a report type and click Generate to create an
                        AI-powered report from your contract data
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
