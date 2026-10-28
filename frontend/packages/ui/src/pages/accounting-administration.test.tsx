import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  EntityAction,
  EntityTableConfig,
  EntityViewConfig,
  FormValues,
  useFormDialog,
} from "../index"
import { useTaxDeadlineAdministration } from "../../../../web/app/(modules)/accounting/features/use-tax-deadline-administration"
import { useTaxGroupAdministration } from "../../../../web/app/(modules)/accounting/features/use-tax-group-administration"
import { useTaxJurisdictionAdministration } from "../../../../web/app/(modules)/accounting/features/use-tax-jurisdiction-administration"
import { useTaxScheduleAdministration } from "../../../../web/app/(modules)/accounting/features/use-tax-schedule-administration"

const commands = vi.hoisted(() => ({
  createDeadline: vi.fn(),
  updateDeadline: vi.fn(),
  completeDeadline: vi.fn(),
  waiveDeadline: vi.fn(),
  deleteDeadline: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  createJurisdiction: vi.fn(),
  updateJurisdiction: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  groupScope: vi.fn(),
  scheduleScope: vi.fn(),
}))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/accounting", () => ({
  useCreateTaxDeadline: () => ({ mutateAsync: commands.createDeadline }),
  useUpdateTaxDeadline: () => ({ mutateAsync: commands.updateDeadline }),
  useCompleteTaxDeadline: () => ({ mutateAsync: commands.completeDeadline }),
  useWaiveTaxDeadline: () => ({ mutateAsync: commands.waiveDeadline }),
  useDeleteTaxDeadline: () => ({ mutateAsync: commands.deleteDeadline }),
  useCreateAccountTaxGroup: (org: number, company: bigint) => {
    commands.groupScope(org, company)
    return { mutateAsync: commands.createGroup }
  },
  useUpdateAccountTaxGroup: () => ({ mutateAsync: commands.updateGroup }),
  useCreateTaxJurisdiction: () => ({
    mutateAsync: commands.createJurisdiction,
  }),
  useUpdateTaxJurisdiction: () => ({
    mutateAsync: commands.updateJurisdiction,
  }),
  useCreateTaxSchedule: (org: number, company: bigint) => {
    commands.scheduleScope(org, company)
    return { mutateAsync: commands.createSchedule }
  },
  useUpdateTaxSchedule: () => ({ mutateAsync: commands.updateSchedule }),
}))
vi.mock("@lumiere/ui/lib/workflow-toast", () => ({
  showWorkflowToast: vi.fn(),
}))
vi.mock("../../../../web/app/(modules)/accounting/read-sections", () => ({
  taxDeadlinesTableConfig: () => ({ view: { type: "table", actions: [] } }),
  taxGroupsTableConfig: () => ({ view: { type: "table", actions: [] } }),
  taxJurisdictionsTableConfig: () => ({ view: { type: "table", actions: [] } }),
  taxSchedulesTableConfig: () => ({ view: { type: "table", actions: [] } }),
  TaxDeadlineRemindersSection: () => null,
}))

function action(config: EntityViewConfig, id: string): EntityAction {
  const found = (config.view as EntityTableConfig).actions?.find((entry) => entry.id === id)
  if (!found) throw new Error(`Missing action ${id}`)
  return found
}
const runTaxCommand = async (_title: string, work: () => Promise<unknown>) => {
  await work()
}
const prompt = () => vi.fn<ReturnType<typeof useFormDialog>["askForm"]>(async () => null)

describe("Accounting tax administration ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("cancels without a command, then reopens the deadline prompt and submits its exact values", async () => {
    const askForm = prompt()
    const { result } = renderHook(() =>
      useTaxDeadlineAdministration({
        organizationId: 7,
        taxDeadlines: [],
        companySelectOptions: [{ value: "9", label: "Company Nine" }],
        askForm,
        runTaxCommand,
      }),
    )
    const create = action(result.current.taxDeadlinesEntityConfig, "tax-deadline-new")
    expect(create.permission).toEqual({
      resource: "tax_deadline",
      action: "create",
    })
    await act(async () => {
      await create.onClick?.([])
    })
    expect(commands.createDeadline).not.toHaveBeenCalled()
    askForm.mockResolvedValueOnce({
      title: "VAT return",
      deadlineType: "Filing",
      dueDate: "2026-11-01",
      companyId: "9",
      description: "Quarterly",
    })
    await act(async () => {
      await create.onClick?.([])
    })
    expect(askForm).toHaveBeenCalledTimes(2)
    expect(commands.createDeadline).toHaveBeenCalledWith(
      expect.objectContaining({ title: "VAT return", company_id: { some: 9 } }),
    )
    expect(
      askForm.mock.calls[1]?.[0].fields.find((field) => field.name === "companyId")?.options,
    ).toEqual([{ value: "9", label: "Company Nine" }])
  })

  it("retains deadline state guards, confirmations and explicit permission boundaries", () => {
    const { result } = renderHook(() =>
      useTaxDeadlineAdministration({
        organizationId: 7,
        taxDeadlines: [],
        companySelectOptions: [],
        askForm: prompt(),
        runTaxCommand,
      }),
    )
    const config = result.current.taxDeadlinesEntityConfig
    expect(
      action(config, "tax-deadline-complete").isApplicable?.([
        { id: "1", status: { tag: "Upcoming" } },
      ]),
    ).toBe(true)
    expect(
      action(config, "tax-deadline-complete").isApplicable?.([
        { id: "1", status: { tag: "Completed" } },
      ]),
    ).toBe(false)
    expect(action(config, "tax-deadline-waive").permission).toEqual({
      resource: "tax_deadline",
      action: "admin",
    })
    expect(action(config, "tax-deadline-waive").confirm).toBeTruthy()
    expect(action(config, "tax-deadline-delete").confirm).toBeTruthy()
  })

  it("keeps a failed deadline write rejected instead of reporting success", async () => {
    const askForm = prompt()
    askForm.mockResolvedValue({
      title: "Tax",
      dueDate: "2026-11-01",
      deadlineType: "Filing",
    })
    const failure = new Error("Permission revoked")
    commands.createDeadline.mockRejectedValueOnce(failure)
    const { result } = renderHook(() =>
      useTaxDeadlineAdministration({
        organizationId: 7,
        taxDeadlines: [],
        companySelectOptions: [],
        askForm,
        runTaxCommand,
      }),
    )
    await expect(
      action(result.current.taxDeadlinesEntityConfig, "tax-deadline-new").onClick?.([]),
    ).rejects.toThrow("Permission revoked")
  })

  it("uses current group scope after a company switch and keeps invalid forms from dispatching", async () => {
    const askForm = prompt()
    const { result, rerender } = renderHook(
      ({ companyId }) =>
        useTaxGroupAdministration({
          organizationId: 7,
          operatingCompanyId: companyId,
          accounts: [],
          taxGroups: [],
          companySelectOptions: [],
          askForm,
          runTaxCommand,
        }),
      { initialProps: { companyId: 9n } },
    )
    askForm.mockResolvedValueOnce({ name: "", sequence: -1 })
    await act(async () => {
      await action(result.current.taxGroupsEntityConfig, "tax-group-new").onClick?.([])
    })
    expect(commands.createGroup).not.toHaveBeenCalled()
    rerender({ companyId: 12n })
    askForm.mockResolvedValueOnce({ name: "VAT", sequence: 10 })
    await act(async () => {
      await action(result.current.taxGroupsEntityConfig, "tax-group-new").onClick?.([])
    })
    expect(commands.groupScope).toHaveBeenLastCalledWith(7, 12n)
    expect(commands.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: "VAT", sequence: 10 }),
    )
    expect(
      action(result.current.taxGroupsEntityConfig, "tax-group-edit").isApplicable?.([
        { id: "1", companyId: "9" },
      ]),
    ).toBe(false)
  })

  it("jurisdiction editing preserves immutable country and emits only changed fields", async () => {
    const askForm = prompt()
    const row = {
      id: "45",
      name: "City",
      code: "CITY",
      countryCode: "US",
      isActive: true,
    }
    askForm.mockImplementationOnce(async (request) => {
      expect(request.fields.some((field) => field.name === "countryCode")).toBe(false)
      return {
        name: "New city",
        code: "CITY",
        stateCode: "",
        countyCode: "",
        city: "",
        zipFrom: "",
        zipTo: "",
        isActive: true,
      }
    })
    const { result } = renderHook(() =>
      useTaxJurisdictionAdministration({
        organizationId: 7,
        taxJurisdictions: [],
        askForm,
        runTaxCommand,
      }),
    )
    await act(async () => {
      await action(result.current.taxJurisdictionsEntityConfig, "tax-jurisdiction-edit").onClick?.([
        row,
      ])
    })
    expect(commands.updateJurisdiction).toHaveBeenCalledWith({
      jurisdictionId: 45n,
      params: expect.objectContaining({
        name: { some: "New city" },
        code: { none: [] },
        isActive: { none: [] },
      }),
    })
  })

  it("schedule authoring retains multiselect cardinality and current company scope", async () => {
    const askForm = prompt()
    const { result, rerender } = renderHook(
      ({ companyId }) =>
        useTaxScheduleAdministration({
          organizationId: 7,
          operatingCompanyId: companyId,
          taxes: [],
          taxJurisdictions: [],
          taxSchedules: [],
          companySelectOptions: [],
          askForm,
          runTaxCommand,
        }),
      { initialProps: { companyId: 9n } },
    )
    rerender({ companyId: 12n })
    askForm.mockResolvedValueOnce({
      name: "VAT schedule",
      jurisdictionId: "",
      taxIds: ["123", "456"],
      effectiveFrom: "2026-01-01",
      effectiveTo: "",
      isActive: true,
    })
    await act(async () => {
      await action(result.current.taxSchedulesEntityConfig, "tax-schedule-new").onClick?.([])
    })
    expect(commands.scheduleScope).toHaveBeenLastCalledWith(7, 12n)
    expect(commands.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ name: "VAT schedule", taxIds: [123n, 456n] }),
    )
    expect(
      askForm.mock.calls[0]?.[0].fields.find((field) => field.name === "taxIds")?.defaultValue,
    ).toEqual([])
  })
})
