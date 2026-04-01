"use client"

import { useState, useRef, useEffect, type FormEvent } from "react"
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  MessageSquare,
  FileText,
  TrendingUp,
  DollarSign,
  PieChart,
  BarChart3,
  RefreshCw,
  Plus,
  Copy,
  Clock,
  Target,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Lightbulb,
  MoreHorizontal,
  History,
  Zap,
  ShieldCheck,
  Handshake,
} from "lucide-react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENDOR_SUGGESTED_QUESTIONS = [
  {
    icon: PieChart,
    label: "Market Share",
    question: "What's my market share at each facility?",
  },
  {
    icon: Clock,
    label: "Expiring Contracts",
    question: "Which contracts are expiring in the next 90 days?",
  },
  {
    icon: DollarSign,
    label: "Pricing Benchmarks",
    question: "How does my pricing compare to market benchmarks?",
  },
  {
    icon: Target,
    label: "Spend Targets",
    question: "What spend targets should I focus on to hit the next tier?",
  },
  {
    icon: TrendingUp,
    label: "Growth Opportunities",
    question: "Where are the biggest opportunities to grow my business?",
  },
  {
    icon: Handshake,
    label: "Facility Relationships",
    question: "How are my facility relationships performing compared to last quarter?",
  },
]

const QUICK_ACTIONS = [
  {
    icon: BarChart3,
    label: "Compare pricing across facilities",
  },
  {
    icon: FileText,
    label: "Review upcoming contract renewals",
  },
  {
    icon: PieChart,
    label: "Analyze category market share",
  },
  {
    icon: DollarSign,
    label: "Calculate rebate projections",
  },
]

const SAMPLE_INSIGHTS = [
  {
    id: "1",
    type: "opportunity" as const,
    title: "Market Share Growth Available",
    description:
      "Your spine portfolio has 23% market share at Memorial Hospital, below the 35% tier threshold. Increasing by 12pp would unlock an additional 2.5% rebate.",
    trend: "up" as const,
    metric: "+12pp needed",
  },
  {
    id: "2",
    type: "alert" as const,
    title: "Contract Renewal in 45 Days",
    description:
      "The trauma instruments agreement with Regional Medical Center expires on May 15. Current compliance is at 87% with spend at $1.2M YTD.",
    trend: "neutral" as const,
    metric: "45 days",
  },
  {
    id: "3",
    type: "performance" as const,
    title: "Pricing Below Benchmark",
    description:
      "Your knee replacement pricing at St. Mary's is 8% below the market median. Consider reviewing margins during the Q2 pricing review.",
    trend: "down" as const,
    metric: "-8% vs median",
  },
  {
    id: "4",
    type: "opportunity" as const,
    title: "Cross-Sell Potential Identified",
    description:
      "3 facilities purchasing your hip systems are not yet contracted for matching surgical instruments. Bundling could increase account value by ~15%.",
    trend: "up" as const,
    metric: "+15% value",
  },
]

const CONTRACT_METRICS = [
  { label: "Active Contracts", value: "24", change: "+3", trend: "up" as const },
  { label: "Avg. Market Share", value: "31%", change: "+2.4pp", trend: "up" as const },
  { label: "Spend Compliance", value: "89%", change: "-1.2%", trend: "down" as const },
  { label: "Renewal Pipeline", value: "7", change: "next 90d", trend: "neutral" as const },
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
            <span className="text-sm text-muted-foreground">
              Analyzing your data...
            </span>
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

function InsightCard({
  insight,
  onAsk,
}: {
  insight: (typeof SAMPLE_INSIGHTS)[number]
  onAsk: (question: string) => void
}) {
  const typeConfig = {
    opportunity: {
      badge: "Opportunity",
      badgeClass: "bg-green-500/10 text-green-700 dark:text-green-400",
      icon: Zap,
    },
    alert: {
      badge: "Alert",
      badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
      icon: Clock,
    },
    performance: {
      badge: "Performance",
      badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
      icon: BarChart3,
    },
  }[insight.type]

  const TrendIcon =
    insight.trend === "up"
      ? ArrowUpRight
      : insight.trend === "down"
        ? ArrowDownRight
        : ChevronRight

  const trendColor =
    insight.trend === "up"
      ? "text-green-600 dark:text-green-400"
      : insight.trend === "down"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground"

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between mb-2">
          <Badge variant="secondary" className={typeConfig.badgeClass}>
            {typeConfig.badge}
          </Badge>
          <div className={`flex items-center gap-1 text-sm font-medium ${trendColor}`}>
            <TrendIcon className="h-4 w-4" />
            {insight.metric}
          </div>
        </div>
        <h4 className="text-sm font-semibold mb-1.5">{insight.title}</h4>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          {insight.description}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() =>
            onAsk(`Tell me more about: ${insight.title}`)
          }
        >
          <MessageSquare className="mr-1.5 h-3 w-3" />
          Ask AI about this
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface VendorAIAgentClientProps {
  vendorId: string
}

export function VendorAIAgentClient({ vendorId }: VendorAIAgentClientProps) {
  const [activeTab, setActiveTab] = useState("chat")
  const [chatInput, setChatInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { portalType: "vendor" },
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

  // Focus input on tab change
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
    setActiveTab("chat")
    sendMessage({ text: question })
  }

  function handleReset() {
    setMessages([])
    setChatInput("")
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Agent</h1>
            <p className="text-sm text-muted-foreground">
              Ask questions about your contracts, market share, and performance
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
        </div>
      </div>

      {/* Metrics bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {CONTRACT_METRICS.map((metric) => {
          const trendColor =
            metric.trend === "up"
              ? "text-green-600 dark:text-green-400"
              : metric.trend === "down"
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
          const TrendIcon =
            metric.trend === "up"
              ? ArrowUpRight
              : metric.trend === "down"
                ? ArrowDownRight
                : ChevronRight

          return (
            <Card key={metric.label}>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">
                  {metric.label}
                </p>
                <div className="flex items-end justify-between">
                  <p className="text-2xl font-bold">{metric.value}</p>
                  <div className={`flex items-center gap-0.5 text-xs ${trendColor}`}>
                    <TrendIcon className="h-3.5 w-3.5" />
                    {metric.change}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
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
          <TabsTrigger value="insights" className="gap-2">
            <Lightbulb className="h-4 w-4" />
            AI Insights
          </TabsTrigger>
          <TabsTrigger value="contracts" className="gap-2">
            <FileText className="h-4 w-4" />
            Contract Intel
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* Chat Tab                                                         */}
        {/* ================================================================ */}
        <TabsContent
          value="chat"
          className="flex-1 flex flex-col overflow-hidden mt-0"
        >
          <Card className="flex flex-1 flex-col overflow-hidden">
            {/* Chat messages area */}
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
                    I can analyze your contracts, track market share, review
                    pricing benchmarks, and identify growth opportunities across
                    your facility accounts.
                  </p>

                  {/* Suggested questions */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 w-full max-w-3xl">
                    {VENDOR_SUGGESTED_QUESTIONS.map((sq) => (
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
                      onCopy={handleCopy}
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
                  placeholder="Ask about contracts, market share, pricing..."
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
                AI responses are based on shared contract data and may require
                verification
              </p>
            </div>
          </Card>

          {/* Quick action chips */}
          <div className="mt-4 flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((action) => (
              <Button
                key={action.label}
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => handleSuggestion(action.label)}
              >
                <action.icon className="h-3.5 w-3.5" />
                {action.label}
              </Button>
            ))}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* Insights Tab                                                     */}
        {/* ================================================================ */}
        <TabsContent value="insights" className="flex-1 overflow-auto mt-0">
          <div className="space-y-4">
            {/* AI Insights header */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                    <Lightbulb className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold mb-1">
                      AI-Generated Insights
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Actionable insights identified by analyzing your contract
                      portfolio, market data, and performance metrics. Click any
                      insight to explore further with the AI assistant.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Insights grid */}
            <div className="grid gap-4 md:grid-cols-2">
              {SAMPLE_INSIGHTS.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  onAsk={handleSuggestion}
                />
              ))}
            </div>

            {/* Strategy suggestions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  Suggested Strategies
                </CardTitle>
                <CardDescription>
                  AI-recommended actions based on your current portfolio
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    {
                      icon: PieChart,
                      title: "Increase Spine Market Share at Memorial Hospital",
                      description:
                        "Focus on converting 3 surgeons currently using competitor products. Potential revenue increase: $340K/year.",
                      priority: "High",
                    },
                    {
                      icon: Handshake,
                      title: "Bundle Instruments with Implant Contracts",
                      description:
                        "3 facilities have separate instrument and implant agreements. Consolidating could improve compliance and rebate tiers.",
                      priority: "Medium",
                    },
                    {
                      icon: DollarSign,
                      title: "Renegotiate Pricing at Regional Medical Center",
                      description:
                        "Your pricing is 8% below median. A 4% adjustment would still be competitive while improving margins by $120K annually.",
                      priority: "Medium",
                    },
                    {
                      icon: ShieldCheck,
                      title: "Address Compliance Gap at City General",
                      description:
                        "Spend compliance dropped to 72% this quarter. Schedule a QBR to review utilization patterns and address concerns.",
                      priority: "High",
                    },
                  ].map((strategy) => (
                    <div
                      key={strategy.title}
                      className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                        <strategy.icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h4 className="text-sm font-medium truncate">
                            {strategy.title}
                          </h4>
                          <Badge
                            variant="secondary"
                            className={
                              strategy.priority === "High"
                                ? "bg-red-500/10 text-red-700 dark:text-red-400 shrink-0"
                                : "shrink-0"
                            }
                          >
                            {strategy.priority}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {strategy.description}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() =>
                          handleSuggestion(
                            `Tell me more about the strategy: ${strategy.title}`
                          )
                        }
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* Contract Intelligence Tab                                        */}
        {/* ================================================================ */}
        <TabsContent value="contracts" className="flex-1 overflow-auto mt-0">
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardContent className="pt-6 pb-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                      <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Total Contract Value
                      </p>
                      <p className="text-xl font-bold">$12.4M</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Across 24 active agreements with 18 facilities
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6 pb-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                      <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Renewals Due (90d)
                      </p>
                      <p className="text-xl font-bold">7</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    $3.1M in contract value at risk of expiration
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6 pb-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                      <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Avg Spend Compliance
                      </p>
                      <p className="text-xl font-bold">89%</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    5 contracts below 80% compliance threshold
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Upcoming renewals */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    Upcoming Renewals
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-xs">
                    View All
                    <ChevronRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    {
                      facility: "Regional Medical Center",
                      contract: "Trauma Instruments",
                      expires: "May 15, 2026",
                      value: "$890K",
                      daysLeft: 45,
                      compliance: 87,
                    },
                    {
                      facility: "St. Mary's Hospital",
                      contract: "Knee Replacement Systems",
                      expires: "Jun 1, 2026",
                      value: "$1.2M",
                      daysLeft: 62,
                      compliance: 94,
                    },
                    {
                      facility: "City General Hospital",
                      contract: "Spine Portfolio",
                      expires: "Jun 20, 2026",
                      value: "$650K",
                      daysLeft: 81,
                      compliance: 72,
                    },
                  ].map((renewal) => (
                    <div
                      key={renewal.contract}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {renewal.contract}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {renewal.facility}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <p className="text-sm font-medium">{renewal.value}</p>
                          <p className="text-xs text-muted-foreground">
                            {renewal.compliance}% compliant
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={
                            renewal.daysLeft <= 60
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : ""
                          }
                        >
                          {renewal.daysLeft}d left
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                handleSuggestion(
                                  `Analyze the ${renewal.contract} contract at ${renewal.facility} and suggest a renewal strategy`
                                )
                              }
                            >
                              <MessageSquare className="mr-2 h-4 w-4" />
                              Ask AI for renewal strategy
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <FileText className="mr-2 h-4 w-4" />
                              View contract details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem>
                              <History className="mr-2 h-4 w-4" />
                              View performance history
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* AI contract analysis prompt */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold mb-1">
                      Ask AI About Your Contracts
                    </h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      Get AI-powered analysis on any aspect of your contract
                      portfolio
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Which facilities have the lowest compliance?",
                        "What's my total rebate exposure?",
                        "Compare pricing across my top 5 accounts",
                        "Identify contracts where I'm losing market share",
                      ].map((q) => (
                        <Button
                          key={q}
                          variant="outline"
                          size="sm"
                          className="h-auto py-1.5 px-3 text-xs"
                          onClick={() => handleSuggestion(q)}
                        >
                          {q}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
