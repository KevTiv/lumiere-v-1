"use client"

import { useState, type ReactNode } from "react"
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
  Upload,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  accountTypeBadgeClass,
  accountTypeIconSurfaceClass,
  type AccountTypeGroup,
} from "../lib/theme-colors"
import type { AccountAccount } from "../lib/accounting-types"
import { useTranslation } from "@lumiere/i18n"

type DisplayGroup = AccountTypeGroup

const groupConfig: Record<
  DisplayGroup,
  { labelKey: string; icon: React.ReactNode; badgeClass: string; iconSurfaceClass: string }
> = {
  asset: {
    labelKey: "accounting.forms.newAccount.fields.options.asset",
    icon: <Wallet className="h-4 w-4" />,
    badgeClass: accountTypeBadgeClass.asset,
    iconSurfaceClass: accountTypeIconSurfaceClass.asset,
  },
  liability: {
    labelKey: "accounting.forms.newAccount.fields.options.liability",
    icon: <CreditCard className="h-4 w-4" />,
    badgeClass: accountTypeBadgeClass.liability,
    iconSurfaceClass: accountTypeIconSurfaceClass.liability,
  },
  equity: {
    labelKey: "accounting.forms.newAccount.fields.options.equity",
    icon: <PiggyBank className="h-4 w-4" />,
    badgeClass: accountTypeBadgeClass.equity,
    iconSurfaceClass: accountTypeIconSurfaceClass.equity,
  },
  income: {
    labelKey: "accounting.forms.newAccount.fields.options.income",
    icon: <TrendingUp className="h-4 w-4" />,
    badgeClass: accountTypeBadgeClass.income,
    iconSurfaceClass: accountTypeIconSurfaceClass.income,
  },
  expense: {
    labelKey: "accounting.forms.newAccount.fields.options.expense",
    icon: <Receipt className="h-4 w-4" />,
    badgeClass: accountTypeBadgeClass.expense,
    iconSurfaceClass: accountTypeIconSurfaceClass.expense,
  },
  other: {
    labelKey: "accounting.forms.newAccount.fields.options.other",
    icon: <TrendingDown className="h-4 w-4" />,
    badgeClass: accountTypeBadgeClass.other,
    iconSurfaceClass: accountTypeIconSurfaceClass.other,
  },
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

type TFunction = ReturnType<typeof useTranslation>["t"]

interface AccountsTableProps {
  accounts: AccountAccount[]
  t: TFunction
}

function AccountsTable({ accounts, t }: AccountsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">{t("accounting.accounts.code")}</TableHead>
          <TableHead className="w-20">{t("accounting.accounts.name")}</TableHead>
          <TableHead className="w-20">{t("accounting.accounts.type")}</TableHead>
          <TableHead className="w-20">{t("accounting.accounts.balance")}</TableHead>
          <TableHead className="w-20">{t("accounting.accounts.status")}</TableHead>
          <TableHead className="w-20">{t("accounting.accounts.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("accounting.accounts.noResults")}</TableCell></TableRow>
        ) : accounts.map((account) => {
          const group = getDisplayGroup(account)
          const conf = groupConfig[group]
          return (
            <TableRow key={String(account.id)}>
              <TableCell className="font-mono font-medium">{account.code}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {account.name}
                  {account.isBankAccount && <Badge variant="outline" className="text-xs">{t("accounting.accounts.badges.bank")}</Badge>}
                  {!account.used && <Badge variant="outline" className="text-xs text-muted-foreground">{t("accounting.accounts.badges.unused")}</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <Badge className={cn("gap-1 border", conf.badgeClass)}>
                  {conf.icon}{t(conf.labelKey as any)}
                </Badge>
              </TableCell>
              <TableCell className={cn("font-medium", account.openingBalance < 0 ? "text-destructive" : "")}>
                {formatCurrency(account.openingBalance)}
              </TableCell>
              <TableCell>
                <Badge variant={account.deprecated ? "secondary" : "default"}>
                  {account.deprecated ? t("accounting.accounts.badges.deprecated") : t("accounting.accounts.badges.active")}
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
  onCreate?: (data: Record<string, unknown>) => void | Promise<void>
  onImportAccountsCsv?: () => void
  /** When set, shows a second top-level tab (e.g. account types & groups). */
  chartStructureContent?: ReactNode
}

export function ChartOfAccountsView({
  accounts,
  onCreate,
  onImportAccountsCsv,
  chartStructureContent,
}: ChartOfAccountsViewProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newCode, setNewCode] = useState("")
  const [newName, setNewName] = useState("")
  const [newGroup, setNewGroup] = useState<DisplayGroup>("asset")
  const [newOpening, setNewOpening] = useState("")

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

  const tabGroups: { value: string; label: string; accounts: AccountAccount[] }[] = [
    { value: "all", label: t("accounting.accounts.all"), accounts: filtered },
    { value: "asset", label: t("accounting.forms.newAccount.fields.options.asset"), accounts: byGroup("asset") },
    { value: "liability", label: t("accounting.forms.newAccount.fields.options.liability"), accounts: byGroup("liability") },
    { value: "equity", label: t("accounting.forms.newAccount.fields.options.equity"), accounts: byGroup("equity") },
    { value: "income", label: t("accounting.forms.newAccount.fields.options.income"), accounts: byGroup("income") },
    { value: "expense", label: t("accounting.forms.newAccount.fields.options.expense"), accounts: byGroup("expense") },
  ]

  const main = (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(["asset", "liability", "equity", "income", "expense"] as DisplayGroup[]).map((g) => {
          const conf = groupConfig[g]
          return (
            <Card key={g}><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", conf.iconSurfaceClass)}>{conf.icon}</div>
                <div>
                  <p className="text-xs text-muted-foreground">{t(conf.labelKey as any)}</p>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("accounting.accounts.title")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {onImportAccountsCsv ? (
                <Button type="button" variant="outline" onClick={onImportAccountsCsv} className="gap-2">
                  <Upload className="h-4 w-4" />
                  {t("accounting.csvImport.toolbarAccounts")}
                </Button>
              ) : null}
              <Button onClick={() => setShowCreateModal(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                {t("accounting.actions.newAccount")}
              </Button>
            </div>
          </div>
          <div className="relative mt-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t("accounting.accounts.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all" className={"flex flex-col"}>
            <TabsList className="mb-4">
              {tabGroups.map(({ value, label, accounts: tabAccounts }) => (
                <TabsTrigger key={value} value={value}>
                  {label} ({tabAccounts.length})
                </TabsTrigger>
              ))}
            </TabsList>
            {tabGroups.map(({ value, accounts: tabAccounts }) => (
              <TabsContent key={value} value={value}>
                <AccountsTable accounts={tabAccounts} t={t} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Create Account Dialog */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("accounting.forms.newAccount.createTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("accounting.forms.newAccount.fields.code")}</Label>
                <Input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder={t("accounting.forms.newAccount.fields.codePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("accounting.forms.newAccount.fields.internalGroup")}</Label>
                <Select value={newGroup} onValueChange={(v) => setNewGroup(v as DisplayGroup)}>
                  <SelectTrigger><SelectValue placeholder={t("accounting.forms.newAccount.fields.accountTypePlaceholder")} /></SelectTrigger>
                  <SelectContent>
                    {(["asset", "liability", "equity", "income", "expense"] as DisplayGroup[]).map((g) => (
                      <SelectItem key={g} value={g}>
                        {t(groupConfig[g].labelKey as any)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("accounting.forms.newAccount.fields.name")}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("accounting.forms.newAccount.fields.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("accounting.forms.newAccount.fields.openingBalance")}</Label>
              <Input
                type="number"
                value={newOpening}
                onChange={(e) => setNewOpening(e.target.value)}
                placeholder={t("accounting.forms.newAccount.fields.openingBalancePlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isCreating}
              onClick={() => setShowCreateModal(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={isCreating}
              onClick={async () => {
                const bal = Number(newOpening) || 0
                setIsCreating(true)
                try {
                  await onCreate?.({
                    code: newCode.trim(),
                    name: newName.trim(),
                    internalGroup: newGroup,
                    internalType: "other",
                    reconcile: false,
                    openingDebit: bal >= 0 ? bal : 0,
                    openingCredit: bal < 0 ? -bal : 0,
                  })
                  setNewCode("")
                  setNewName("")
                  setNewGroup("asset")
                  setNewOpening("")
                  setShowCreateModal(false)
                } finally {
                  setIsCreating(false)
                }
              }}
            >
              {t("accounting.forms.newAccount.submitLabel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )

  if (chartStructureContent) {
    return (
      <Tabs defaultValue="accounts" className="flex flex-col gap-6">
        <TabsList>
          <TabsTrigger value="accounts">{t("accounting.accounts.coasTab")}</TabsTrigger>
          <TabsTrigger value="structure">{t("accounting.chartStructure.tabLabel")}</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-0">
          {main}
        </TabsContent>
        <TabsContent value="structure" className="mt-0">
          {chartStructureContent}
        </TabsContent>
      </Tabs>
    )
  }

  return main
}
