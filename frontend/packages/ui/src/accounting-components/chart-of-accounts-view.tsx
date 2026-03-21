"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Search,
  Plus,
  Edit,
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  PiggyBank,
  Receipt,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { AccountAccount } from "../lib/accounting-types"

type DisplayGroup = "asset" | "liability" | "equity" | "income" | "expense" | "other"

const groupConfig: Record<DisplayGroup, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  asset: { label: "Assets", icon: <Wallet className="h-4 w-4" />, color: "text-blue-600", bgColor: "bg-blue-500/10" },
  liability: { label: "Liabilities", icon: <CreditCard className="h-4 w-4" />, color: "text-red-600", bgColor: "bg-red-500/10" },
  equity: { label: "Equity", icon: <PiggyBank className="h-4 w-4" />, color: "text-purple-600", bgColor: "bg-purple-500/10" },
  income: { label: "Revenue", icon: <TrendingUp className="h-4 w-4" />, color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  expense: { label: "Expenses", icon: <Receipt className="h-4 w-4" />, color: "text-amber-600", bgColor: "bg-amber-500/10" },
  other: { label: "Other", icon: <TrendingDown className="h-4 w-4" />, color: "text-gray-600", bgColor: "bg-gray-500/10" },
}

function getDisplayGroup(account: AccountAccount): DisplayGroup {
  const group = String(account.internalGroup ?? "")
  if (group === "Asset") return "asset"
  if (group === "Liability") return "liability"
  if (group === "Equity") return "equity"
  if (group === "Income") return "income"
  if (group === "Expense") return "expense"
  return "other"
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)

interface AccountsTableProps {
  accounts: AccountAccount[]
}

function AccountsTable({ accounts }: AccountsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Account Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Balance</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[80px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No accounts found</TableCell></TableRow>
        ) : accounts.map((account) => {
          const group = getDisplayGroup(account)
          const conf = groupConfig[group]
          return (
            <TableRow key={String(account.id)}>
              <TableCell className="font-mono font-medium">{account.code}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {account.name}
                  {account.isBankAccount && <Badge variant="outline" className="text-xs">Bank</Badge>}
                  {!account.used && <Badge variant="outline" className="text-xs text-muted-foreground">Unused</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <Badge className={cn("gap-1 bg-transparent border", conf.color)}>
                  {conf.icon}{conf.label}
                </Badge>
              </TableCell>
              <TableCell className={cn("font-medium", account.openingBalance < 0 ? "text-red-600" : "")}>
                {formatCurrency(account.openingBalance)}
              </TableCell>
              <TableCell>
                <Badge variant={account.deprecated ? "secondary" : "default"}>
                  {account.deprecated ? "Deprecated" : "Active"}
                </Badge>
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Edit className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

interface ChartOfAccountsViewProps {
  accounts: AccountAccount[]
  onCreate?: (data: Record<string, unknown>) => void
}

export function ChartOfAccountsView({ accounts, onCreate }: ChartOfAccountsViewProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)

  const filtered = accounts.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.code.includes(searchQuery)
  )

  const byGroup = (g: DisplayGroup) => accounts.filter((a) => getDisplayGroup(a) === g)

  const totals = {
    asset: byGroup("asset").reduce((s, a) => s + a.openingBalance, 0),
    liability: byGroup("liability").reduce((s, a) => s + a.openingBalance, 0),
    equity: byGroup("equity").reduce((s, a) => s + a.openingBalance, 0),
    income: byGroup("income").reduce((s, a) => s + a.openingBalance, 0),
    expense: byGroup("expense").reduce((s, a) => s + a.openingBalance, 0),
    other: byGroup("other").reduce((s, a) => s + a.openingBalance, 0),
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(["asset", "liability", "equity", "income", "expense"] as DisplayGroup[]).map((g) => {
          const conf = groupConfig[g]
          return (
            <Card key={g}><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", conf.bgColor)}>
                  <span className={conf.color}>{conf.icon}</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{conf.label}</p>
                  <p className="text-lg font-bold">{formatCurrency(totals[g])}</p>
                </div>
              </div>
            </CardContent></Card>
          )
        })}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>Chart of Accounts</CardTitle>
            <Button onClick={() => setShowCreateModal(true)} className="gap-2"><Plus className="h-4 w-4" />New Account</Button>
          </div>
          <div className="relative mt-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search accounts..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all" className={"flex flex-col"}>
            <TabsList className="mb-4">
              <TabsTrigger value="all">All ({accounts.length})</TabsTrigger>
              <TabsTrigger value="asset">Assets ({byGroup("asset").length})</TabsTrigger>
              <TabsTrigger value="liability">Liabilities ({byGroup("liability").length})</TabsTrigger>
              <TabsTrigger value="equity">Equity ({byGroup("equity").length})</TabsTrigger>
              <TabsTrigger value="income">Revenue ({byGroup("income").length})</TabsTrigger>
              <TabsTrigger value="expense">Expenses ({byGroup("expense").length})</TabsTrigger>
            </TabsList>
            <TabsContent value="all"><AccountsTable accounts={filtered} /></TabsContent>
            <TabsContent value="asset"><AccountsTable accounts={byGroup("asset")} /></TabsContent>
            <TabsContent value="liability"><AccountsTable accounts={byGroup("liability")} /></TabsContent>
            <TabsContent value="equity"><AccountsTable accounts={byGroup("equity")} /></TabsContent>
            <TabsContent value="income"><AccountsTable accounts={byGroup("income")} /></TabsContent>
            <TabsContent value="expense"><AccountsTable accounts={byGroup("expense")} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Create Account Dialog */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create New Account</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Account Code</Label>
                <Input placeholder="e.g., 1001" />
              </div>
              <div className="space-y-2">
                <Label>Account Type</Label>
                <Select>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Asset">Asset</SelectItem>
                    <SelectItem value="Liability">Liability</SelectItem>
                    <SelectItem value="Equity">Equity</SelectItem>
                    <SelectItem value="Income">Revenue</SelectItem>
                    <SelectItem value="Expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Account Name</Label>
              <Input placeholder="Account name" />
            </div>
            <div className="space-y-2">
              <Label>Opening Balance</Label>
              <Input type="number" placeholder="0.00" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={() => { onCreate?.({}); setShowCreateModal(false) }}>Create Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
