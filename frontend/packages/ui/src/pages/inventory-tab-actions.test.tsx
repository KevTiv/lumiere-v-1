import { act, cleanup, renderHook } from '@testing-library/react';
import { isValidElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EntityAction } from '../lib/entity-view-types';
import type { ModuleTab } from '../lib/module-types';
import type { FormModalProps } from '../forms/form-modal';
import { useFormDialog } from '../forms/use-form-dialog';

const state = vi.hoisted(() => ({
  done: vi.fn(),
  other: vi.fn(),
  useStartTask: vi.fn(),
  useStartQuality: vi.fn(),
}));
vi.mock('@lumiere/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@lumiere/ui', async () => ({
  ...(await import('../forms/use-form-dialog')),
  newQualityCheckForm: () => ({
    id: 'quality',
    title: 'Quality',
    sections: [],
  }),
  mergeSelectOptionsForFields: (form: unknown) => form,
}));
vi.mock('@lumiere/query-hooks/hooks/inventory', () => {
  const mutation = () => ({ isPending: false, mutateAsync: state.other });
  return {
    useCreateStockMove: mutation,
    useConfirmStockMove: mutation,
    useAssignStockMove: mutation,
    useCancelStockMove: mutation,
    useDoneStockMove: (org: bigint, company: bigint) => ({
      isPending: false,
      mutateAsync: (value: unknown) => state.done(org, company, value),
    }),
    useStartWarehouseTask: (org: bigint, company: bigint | undefined) => {
      state.useStartTask(org, company);
      return mutation();
    },
    useCompleteWarehouseTask: mutation,
    useCancelWarehouseTask: mutation,
    useUpdateWarehouseTaskStatus: mutation,
    usePassQualityCheck: mutation,
    useStartQualityCheck: (org: bigint, company: bigint | undefined) => {
      state.useStartQuality(org, company);
      return mutation();
    },
    useLinkDeviceToQualityCheck: mutation,
    useCreateQualityAlertReason: mutation,
    useUpdateQualityAlertReason: mutation,
    useDeleteQualityAlertReason: mutation,
    useAddMemberToQualityTeam: mutation,
    useRemoveMemberFromQualityTeam: mutation,
    useUpdateQualityPoint: mutation,
    useUpdateQualityTeam: mutation,
  };
});
vi.mock('@lumiere/query-hooks/hooks/quality-check-fail-workflow', () => ({
  useQualityCheckFailWorkflow: () => ({ isPending: false, fail: state.other }),
}));
import { useStockMoveTabActions } from '../../../../web/app/(modules)/inventory/stock-move-tab-actions';
import { useWarehouseTaskTabActions } from '../../../../web/app/(modules)/inventory/warehouse-task-tab-actions';
import { useQualityCheckTabActions } from '../../../../web/app/(modules)/inventory/quality-check-tab-actions';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function tableTab(id: string): ModuleTab {
  return {
    id,
    label: id,
    type: 'entity',
    entityConfig: { id, title: id, view: { mode: 'table', columns: [] } },
  };
}
function action(tab: ModuleTab, id: string): EntityAction {
  if (tab.entityConfig?.view.mode !== 'table')
    throw new Error('Expected table');
  const found = tab.entityConfig.view.actions?.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing action ${id}`);
  return found;
}
function promptProps(
  dialog: ReturnType<typeof useFormDialog>['formDialog'],
): FormModalProps {
  if (!isValidElement<FormModalProps>(dialog))
    throw new Error('Expected form dialog');
  return dialog.props;
}
function useMoveActions(companyId: bigint) {
  const dialog = useFormDialog();
  const moves = useStockMoveTabActions({
    orgId: 91n,
    operatingCompanyId: companyId,
    askForm: dialog.askForm,
    productSelectOptions: [],
    uomFieldOptions: [],
    stockOnHandLocationOptions: [],
  });
  return { ...dialog, moves };
}

it('completes the selected large-ID stock move with fresh prompt values and current company', async () => {
  const hook = renderHook(({ companyId }) => useMoveActions(companyId), {
    initialProps: { companyId: 7n },
  });
  const row = {
    id: '9007199254740993',
    state: { tag: 'Assigned' },
    productUomQty: 4,
  };
  const done = action(
    hook.result.current.moves.configureTab(tableTab('stock-moves')),
    'done-move',
  );
  expect(done.isApplicable?.([row])).toBe(true);
  expect(done.isApplicable?.([{ ...row, state: { tag: 'Done' } }])).toBe(false);
  let result!: ReturnType<EntityAction['onClick']>;
  act(() => {
    result = done.onClick([row]);
  });
  const prompt = promptProps(hook.result.current.formDialog);
  expect(prompt.config.sections[0].fields[0].defaultValue).toBe(4);
  expect(prompt.draft).toBe(false);
  await act(async () => {
    await prompt.onSubmit?.({ quantityDone: 2 });
    await result;
  });
  expect(state.done).toHaveBeenCalledExactlyOnceWith(91n, 7n, {
    moveId: '9007199254740993',
    quantityDone: 2,
  });
  expect(hook.result.current.formDialog).toBeNull();
  hook.rerender({ companyId: 8n });
  const next = action(
    hook.result.current.moves.configureTab(tableTab('stock-moves')),
    'done-move',
  );
  act(() => {
    result = next.onClick([
      { ...row, id: '9007199254740995', productUomQty: 9 },
    ]);
  });
  const reopened = promptProps(hook.result.current.formDialog);
  expect(reopened.config.sections[0].fields[0].defaultValue).toBe(9);
  await act(async () => {
    await reopened.onSubmit?.({ quantityDone: 8 });
    await result;
  });
  expect(state.done).toHaveBeenLastCalledWith(91n, 8n, {
    moveId: '9007199254740995',
    quantityDone: 8,
  });
});

it('cancels without mutation and reopens a clean prompt after a rejected move', async () => {
  const hook = renderHook(() => useMoveActions(7n));
  const done = action(
    hook.result.current.moves.configureTab(tableTab('stock-moves')),
    'done-move',
  );
  let result!: ReturnType<EntityAction['onClick']>;
  act(() => {
    result = done.onClick([{ id: '1', state: 'assigned', productUomQty: 3 }]);
  });
  await act(async () => {
    hook.result.current.cancelForm();
    await result;
  });
  expect(state.done).not.toHaveBeenCalled();
  state.done.mockRejectedValueOnce(new Error('Current source changed'));
  act(() => {
    result = done.onClick([{ id: '2', state: 'assigned', productUomQty: 5 }]);
  });
  const rejected = expect(result).rejects.toThrow('Current source changed');
  await act(async () => {
    await promptProps(hook.result.current.formDialog).onSubmit?.({
      quantityDone: 1,
    });
    await rejected;
  });
  expect(state.done).toHaveBeenCalledTimes(1);
  act(() => {
    result = done.onClick([{ id: '3', state: 'assigned', productUomQty: 7 }]);
  });
  expect(
    promptProps(hook.result.current.formDialog).config.sections[0].fields[0]
      .defaultValue,
  ).toBe(7);
  await act(async () => {
    hook.result.current.cancelForm();
    await result;
  });
  expect(state.done).toHaveBeenCalledTimes(1);
});

it('preserves missing versus selected company for task and quality operations', async () => {
  const hook = renderHook(
    ({ selectedCompanyId }: { selectedCompanyId: bigint | undefined }) => {
      const dialog = useFormDialog();
      const tasks = useWarehouseTaskTabActions({
        orgId: 91n,
        selectedOperatingCompanyId: selectedCompanyId,
        askForm: dialog.askForm,
        warehouseTaskStatusOptions: [],
      });
      const quality = useQualityCheckTabActions({
        orgId: 91n,
        operatingCompanyId: selectedCompanyId ?? 0n,
        selectedOperatingCompanyId: selectedCompanyId,
        askForm: dialog.askForm,
        workflowSurface: {
          notify: vi.fn(),
          navigate: vi.fn(),
          record: vi.fn(),
        },
        products: [],
        warehouses: [],
        qualityTeamOptions: [
          { value: '9007199254740993', label: 'Operations' },
          { value: '', label: 'Unavailable' },
        ],
        stockOnHandLocationOptions: [],
        iotDeviceOptions: [],
        setActiveTab: vi.fn(),
        setCreateQualityAlertOpen: vi.fn(),
      });
      return { tasks, quality, ...dialog };
    },
    { initialProps: { selectedCompanyId: undefined } },
  );
  expect(state.useStartTask).toHaveBeenLastCalledWith(91n, undefined);
  expect(state.useStartQuality).toHaveBeenLastCalledWith(91n, undefined);
  hook.rerender({ selectedCompanyId: 12n });
  expect(state.useStartTask).toHaveBeenLastCalledWith(91n, 12n);
  expect(state.useStartQuality).toHaveBeenLastCalledWith(91n, 12n);
  expect(hook.result.current.tasks.configureTab(tableTab('products'))).toEqual(
    tableTab('products'),
  );
  expect(
    action(
      hook.result.current.quality.configureTab(tableTab('quality')),
      'start-check',
    ).isApplicable?.([{ status: { tag: 'Draft' } }]),
  ).toBe(true);
  expect(
    action(
      hook.result.current.quality.configureTab(tableTab('quality')),
      'start-check',
    ).isApplicable?.([{ status: { tag: 'Completed' } }]),
  ).toBe(false);
  let teamPrompt!: ReturnType<EntityAction['onClick']>;
  act(() => {
    teamPrompt = action(
      hook.result.current.quality.configureTab(tableTab('quality')),
      'add-team-member',
    ).onClick([]);
  });
  expect(
    promptProps(hook.result.current.formDialog).config.sections[0].fields[0]
      .options,
  ).toEqual([{ value: '9007199254740993', label: 'Operations' }]);
  await act(async () => {
    hook.result.current.cancelForm();
    await teamPrompt;
  });
  expect(state.other).not.toHaveBeenCalled();
});
