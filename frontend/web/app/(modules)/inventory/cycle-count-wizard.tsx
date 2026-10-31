'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@lumiere/i18n';
import { Button, EntityView, cn, useRBAC } from '@lumiere/ui';
import { parseStrictU64 } from '@lumiere/erp-shared/u64';
import { getRowField } from '@lumiere/ui/lib/entity-row-values';
import { CYCLE_COUNT_PERMISSIONS, assertCycleCountScope, cycleCountId as requireCountId, cycleCountQuantity, prepareCycleCountLine, type CycleCountAction } from './cycle-count-input';
import { Input } from '@lumiere/ui';
import { Label } from '@lumiere/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { qualityAlertsTableConfig } from '@lumiere/ui';
import {
  useCreateCycleCountPlan,
  useStartCycleCountSession,
  useRecordCycleCountLine,
  useValidateCycleCount,
  useOpenQualityAlert,
  useQualityAlerts,
  useSolveQualityAlert,
  useCancelQualityAlert,
} from '@lumiere/query-hooks/hooks/inventory';
import { useCycleCountAdjustmentWorkflow } from '@lumiere/query-hooks/hooks/cycle-count-adjustment-workflow';
import { variantTag } from '@lumiere/erp-workflows';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import type { QueryRows } from '@/lib/query-fetch';
import { ChevronRight, MapPin, Package } from 'lucide-react';

type ScalarId = bigint | number | string;

function strId(v: unknown): string {
  return v == null ? '' : String(v);
}

type WizardStep = 1 | 2 | 3 | 4 | 5;

const WIZARD_STEPS: WizardStep[] = [1, 2, 3, 4, 5];

/** Lower-cased state of a row (handles `{tag}` enum values), for action gating. */
function rowState(row: Record<string, unknown>, key = 'state'): string {
  return variantTag(row[key]).toLowerCase();
}

/** Runs a wizard mutation; failures surface as an error toast and the wizard stays on its step. */
async function runStep(
  run: () => Promise<unknown>,
  title: string,
  onDone?: () => void,
): Promise<void> {
  try {
    await run();
    onDone?.();
  } catch (error) {
    showWorkflowToast({
      kind: 'error',
      title,
      description: error instanceof Error ? error.message : undefined,
    });
  }
}

export function CycleCountWizard({
  organizationId,
  operatingCompanyId,
  locations,
  cycleCounts: allCycleCounts,
  products,
  uoms,
  initialCycleCountId,
}: {
  organizationId: number;
  operatingCompanyId?: bigint;
  locations: QueryRows;
  cycleCounts: QueryRows;
  products: QueryRows;
  uoms: QueryRows;
  initialCycleCountId?: ScalarId | '';
}) {
  const { t } = useTranslation();
  const { checkPermission, permissionsReady, currentUser } = useRBAC();
  const orgId = BigInt(organizationId);
  const scope = { organizationId: String(organizationId), companyId: String(operatingCompanyId ?? ''), actorId: currentUser?.id ?? '' };
  const allowed = (action: CycleCountAction) => {
    const permission = CYCLE_COUNT_PERMISSIONS[action];
    return permissionsReady !== false && currentUser != null && operatingCompanyId != null && operatingCompanyId > 0n && checkPermission(permission.resource, permission.action).allowed;
  };
  const live = useRef({ scope, allowed, mounted: true });
  live.current = { scope, allowed, mounted: live.current.mounted };
  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; };
  }, []);
  const scopeMessage = t('inventory.warehouseWorkspace.scopeChanged', { defaultValue: 'Your company, account or permissions changed. Reopen this workspace before continuing.' });
  const assertCurrent = (action: CycleCountAction) => assertCycleCountScope(scope, {
    ...live.current.scope, mounted: live.current.mounted, allowed: live.current.allowed(action),
  }, scopeMessage);
  const inputMessage = t('inventory.warehouseWorkspace.countInputInvalid', { defaultValue: 'Choose available count, product, location and unit records, and enter a finite quantity of zero or more.' });
  const cycleCounts = useMemo(() => allCycleCounts.filter((row) =>
    parseStrictU64(getRowField(row, 'organizationId')) === orgId &&
    operatingCompanyId != null && parseStrictU64(getRowField(row, 'companyId')) === operatingCompanyId,
  ), [allCycleCounts, orgId, operatingCompanyId]);
  const createPlan = useCreateCycleCountPlan(orgId, operatingCompanyId);
  const startSession = useStartCycleCountSession(orgId, operatingCompanyId);
  const recordLine = useRecordCycleCountLine(orgId, operatingCompanyId);
  const validate = useValidateCycleCount(orgId, operatingCompanyId);
  const workflowSurface = useWorkflowSurface({ organizationId });
  const postAdj = useCycleCountAdjustmentWorkflow(
    orgId,
    operatingCompanyId ?? 0n,
    workflowSurface,
  );

  const [step, setStep] = useState<WizardStep>(1);
  const [cycleCountId, setCycleCountId] = useState<ScalarId | ''>(
    initialCycleCountId ?? '',
  );
  const [locationId, setLocationId] = useState('');
  const [planName, setPlanName] = useState('');
  const [countBy, setCountBy] = useState('product');
  const [frequency, setFrequency] = useState('monthly');
  const [tolPct, setTolPct] = useState('0');
  const [tolVal, setTolVal] = useState('0');
  const [recProductId, setRecProductId] = useState('');
  const [recLocId, setRecLocId] = useState('');
  const [recQty, setRecQty] = useState('');
  const [recUom, setRecUom] = useState('');
  const [recordedLine, setRecordedLine] = useState<ReturnType<typeof prepareCycleCountLine> | null>(null);

  useEffect(() => {
    setCycleCountId(initialCycleCountId ?? '');
    setRecordedLine(null);
    setRecProductId('');
    setRecLocId('');
    setRecQty('');
    setRecUom('');
    setStep(initialCycleCountId != null && initialCycleCountId !== '' ? 2 : 1);
  }, [initialCycleCountId, organizationId, operatingCompanyId, currentUser?.id]);

  const selectedCount = useMemo(
    () => cycleCounts.find((c) => strId(c.id) === strId(cycleCountId)),
    [cycleCounts, cycleCountId],
  );

  const locOpts = locations.map((l) => {
    const id = strId(l.id);
    return (
      <SelectItem key={id} value={id}>
        {String(l.completeName ?? l.name ?? id)}
      </SelectItem>
    );
  });

  const countOpts = cycleCounts.map((c) => {
    const id = strId(c.id);
    return (
      <SelectItem key={id} value={id}>
        {`${id} — ${String(c.name ?? 'Count')} (${String(c.state ?? '—')})`}
      </SelectItem>
    );
  });

  const productOpts = products.map((p) => {
    const id = strId(p.id);
    return (
      <SelectItem key={id} value={id}>
        {String(p.name ?? p.defaultCode ?? id)}
      </SelectItem>
    );
  });

  const selectedProduct = products.find((row) => strId(row.id) === recProductId);
  const stockUomId = selectedProduct ? parseStrictU64(getRowField(selectedProduct, 'uomId')) : undefined;
  const uomOpts = uoms.filter((unit) => stockUomId != null && parseStrictU64(unit.id) === stockUomId).map((u) => {
    const id = strId(u.id);
    return (
      <SelectItem key={id} value={id}>
        {String(u.name ?? id)}
      </SelectItem>
    );
  });

  let preparedLine: ReturnType<typeof prepareCycleCountLine> | null = null;
  try {
    if (selectedCount && selectedProduct && locations.some((row) => strId(row.id) === recLocId) && uoms.some((row) => strId(row.id) === recUom)) {
      preparedLine = prepareCycleCountLine({ cycleCountId, productId: recProductId, locationId: recLocId, uomId: recUom, stockUomId, quantity: recQty }, inputMessage);
    }
  } catch { /* The form remains editable until all count values are valid. */ }

  const selectedCountId = () => {
    if (!selectedCount) throw new Error(inputMessage);
    return requireCountId(cycleCountId, inputMessage);
  };

  const stepLabels: Record<WizardStep, string> = {
    1: t('inventory.cycleCountWizard.stepPlan'),
    2: t('inventory.cycleCountWizard.stepStart'),
    3: t('inventory.cycleCountWizard.stepRecord'),
    4: t('inventory.cycleCountWizard.stepValidate'),
    5: t('inventory.cycleCountWizard.stepPost'),
  };

  const canAdvance =
    (step === 1 && Boolean(locationId)) ||
    (step === 2 && cycleCountId !== '') ||
    (step === 3 && recProductId && recLocId && recQty && recUom) ||
    step === 4 ||
    step === 5;

  const goNext = useCallback(() => {
    setStep((s) => (s < 5 ? ((s + 1) as WizardStep) : s));
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s));
  }, []);

  return (
    <div className="space-y-6 max-w-[800px] text-sm">
      <div>
        <h2 className="text-lg font-semibold">
          {t('inventory.cycleCountWizard.title')}
        </h2>
        <p className="text-muted-foreground">
          {t('inventory.cycleCountWizard.subtitle')}
        </p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((s) => (
          <li key={s}>
            <button
              type="button"
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                step === s
                  ? 'border-primary bg-primary text-primary-foreground'
                  : step > s
                    ? 'border-primary/40 text-primary'
                    : 'border-border text-muted-foreground',
              )}
              onClick={() => setStep(s)}
            >
              {stepLabels[s]}
            </button>
          </li>
        ))}
      </ol>

      {selectedCount ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          {t('inventory.cycleCountWizard.activeCount', {
            id: strId(selectedCount.id),
            state: String(selectedCount.state ?? '—'),
          })}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[1]}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cc-loc">
                {t('inventory.cycleCountWizard.locationId')}
              </Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="cc-loc">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>{locOpts}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-name">
                {t('inventory.cycleCountWizard.planName')}
              </Label>
              <Input
                id="cc-name"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder={t(
                  'inventory.cycleCountWizard.planNamePlaceholder',
                )}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-by">
                {t('inventory.cycleCountWizard.countBy')}
              </Label>
              <Input
                id="cc-by"
                value={countBy}
                onChange={(e) => setCountBy(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-freq">
                {t('inventory.cycleCountWizard.frequency')}
              </Label>
              <Input
                id="cc-freq"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-tp">
                {t('inventory.cycleCountWizard.tolerancePct')}
              </Label>
              <Input
                id="cc-tp"
                type="number"
                min={0}
                step="any"
                value={tolPct}
                onChange={(e) => setTolPct(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-tv">
                {t('inventory.cycleCountWizard.toleranceVal')}
              </Label>
              <Input
                id="cc-tv"
                type="number"
                min={0}
                step="any"
                value={tolVal}
                onChange={(e) => setTolVal(e.target.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            data-testid="cycle-wizard-create-plan"
            disabled={createPlan.isPending || !locationId || !allowed('plan')}
            onClick={() => {
              void runStep(
                async () => {
                  assertCurrent('plan');
                  if (!locations.some((row) => strId(row.id) === locationId)) throw new Error(inputMessage);
                  await createPlan.mutateAsync({
                    locationId: requireCountId(locationId, inputMessage),
                    params: {
                      name: planName.trim() || undefined,
                      countBy,
                      frequency,
                      tolerancePercentage: cycleCountQuantity(tolPct, inputMessage),
                      toleranceValue: cycleCountQuantity(tolVal, inputMessage),
                      nextCountDate: undefined,
                      userId: undefined,
                      teamId: undefined,
                      productIds: [],
                      productCategoryIds: [],
                      reason: undefined,
                      notes: undefined,
                      metadata: undefined,
                    },
                  });
                  assertCurrent('plan');
                },
                t('inventory.cycleCountWizard.createPlan'),
                () => { setCycleCountId(''); setRecordedLine(null); setStep(2); },
              );
            }}
          >
            {t('inventory.cycleCountWizard.createPlan')}
          </Button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[2]}</h3>
          <p className="text-muted-foreground text-xs">{t('inventory.warehouseWorkspace.selectCount', { defaultValue: 'Choose the count plan to continue. New plans are never selected automatically.' })}</p>
          <div className="space-y-1">
            <Label htmlFor="cc-id">
              {t('inventory.cycleCountWizard.cycleCountId')}
            </Label>
            <Select
              value={cycleCountId === '' ? '' : strId(cycleCountId)}
              onValueChange={(value) => { setCycleCountId(value); setRecordedLine(null); }}
            >
              <SelectTrigger id="cc-id">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>{countOpts}</SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            data-testid="cycle-wizard-start-session"
            disabled={startSession.isPending || !selectedCount || !allowed('start')}
            onClick={() =>
              void runStep(
                async () => { assertCurrent('start'); await startSession.mutateAsync(selectedCountId()); assertCurrent('start'); },
                t('inventory.cycleCountWizard.startSession'),
                goNext,
              )
            }
          >
            {t('inventory.cycleCountWizard.startSession')}
          </Button>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[3]}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cc-prod">
                {t('inventory.cycleCountWizard.productId')}
              </Label>
              <Select value={recProductId} onValueChange={(value) => { setRecProductId(value); setRecUom(''); }}>
                <SelectTrigger id="cc-prod">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>{productOpts}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-rec-loc">
                {t('inventory.cycleCountWizard.recordLocationId')}
              </Label>
              <Select value={recLocId} onValueChange={setRecLocId}>
                <SelectTrigger id="cc-rec-loc">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>{locOpts}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-qty">
                {t('inventory.cycleCountWizard.qtyCounted')}
              </Label>
              <Input
                id="cc-qty"
                type="number"
                min={0}
                step="any"
                value={recQty}
                onChange={(e) => setRecQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-uom">
                {t('inventory.cycleCountWizard.uomId')}
              </Label>
              <Select value={recUom} onValueChange={setRecUom}>
                <SelectTrigger id="cc-uom">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>{uomOpts}</SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{t('inventory.warehouseWorkspace.countBaseUnit', { defaultValue: 'Count in the product’s stock unit. Unit conversion is not applied.' })}</p>
            </div>
          </div>
          <Button
            type="button"
            data-testid="cycle-wizard-record-line"
            disabled={recordLine.isPending || preparedLine == null || !allowed('line')}
            onClick={() =>
              void runStep(
                async () => {
                  assertCurrent('line');
                  if (!preparedLine) throw new Error(inputMessage);
                  await recordLine.mutateAsync(preparedLine);
                  assertCurrent('line');
                  setRecordedLine(preparedLine);
                },
                t('inventory.cycleCountWizard.recordLine'),
                goNext,
              )
            }
          >
            {t('inventory.cycleCountWizard.recordLine')}
          </Button>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[4]}</h3>
          <p className="text-muted-foreground text-xs">
            {t('inventory.cycleCountWizard.validateHint')}
          </p>
          <Button
            type="button"
            variant="secondary"
            data-testid="cycle-wizard-validate"
            disabled={validate.isPending || !selectedCount || !allowed('validate')}
            onClick={() =>
              void runStep(
                async () => { assertCurrent('validate'); await validate.mutateAsync(selectedCountId()); assertCurrent('validate'); },
                t('inventory.cycleCountWizard.validate'),
                goNext,
              )
            }
          >
            {t('inventory.cycleCountWizard.validate')}
          </Button>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[5]}</h3>
          <p className="text-muted-foreground text-xs">
            {t('inventory.cycleCountWizard.postHint')}
          </p>
          {!recordedLine ? <p className="text-muted-foreground text-xs">{t('inventory.warehouseWorkspace.recordBeforePost', { defaultValue: 'Posting applies the validated count plan. Record a line here before posting.' })}</p> : null}
          <Button
            type="button"
            data-testid="cycle-wizard-post"
            disabled={postAdj.isPending || !selectedCount || !recordedLine || recordedLine.cycleCountId !== parseStrictU64(cycleCountId) || !allowed('post')}
            onClick={() =>
              void runStep(async () => {
                assertCurrent('post');
                if (!recordedLine || recordedLine.cycleCountId !== selectedCountId()) throw new Error(inputMessage);
                await postAdj.post(
                  {
                    cycleCountId: String(recordedLine.cycleCountId),
                    productId: String(recordedLine.params.productId),
                    locationId: String(recordedLine.params.locationId),
                    companyId: String(requireCountId(operatingCompanyId, inputMessage)),
                    countedQty: recordedLine.params.qtyCounted,
                  },
                  { navigateToNext: true, assertScope: () => assertCurrent('post') },
                );
              }, t('inventory.cycleCountWizard.post'))
            }
          >
            {t('inventory.cycleCountWizard.post')}
          </Button>
        </section>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={step === 1}
          onClick={goBack}
        >
          {t('common.back')}
        </Button>
        {step < 5 && step !== 2 && step !== 3 && step !== 4 ? (
          <Button type="button" disabled={!canAdvance} onClick={goNext}>
            {t('common.next')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type LocationTreeNode = {
  id: string;
  row: Record<string, unknown>;
  children: LocationTreeNode[];
  quantCount: number;
};

function buildLocationTree(
  locations: QueryRows,
  quants: QueryRows,
): LocationTreeNode[] {
  const byParent = new Map<string, LocationTreeNode[]>();
  const nodes = new Map<string, LocationTreeNode>();

  for (const loc of locations) {
    const id = strId(loc.id);
    if (!id) continue;
    const quantCount = quants.filter((q) => strId(q.locationId) === id).length;
    nodes.set(id, {
      id,
      row: loc as Record<string, unknown>,
      children: [],
      quantCount,
    });
  }

  for (const node of nodes.values()) {
    const parentRaw = node.row.locationId ?? node.row.location_id;
    const parentId =
      parentRaw == null || parentRaw === 0 || parentRaw === '0'
        ? ''
        : strId(parentRaw);
    const bucket = byParent.get(parentId) ?? [];
    bucket.push(node);
    byParent.set(parentId, bucket);
  }

  const attach = (node: LocationTreeNode) => {
    node.children = (byParent.get(node.id) ?? []).sort((a, b) =>
      String(a.row.completeName ?? a.row.name ?? '').localeCompare(
        String(b.row.completeName ?? b.row.name ?? ''),
      ),
    );
    node.children.forEach(attach);
  };

  const roots = (byParent.get('') ?? []).sort((a, b) =>
    String(a.row.completeName ?? a.row.name ?? '').localeCompare(
      String(b.row.completeName ?? b.row.name ?? ''),
    ),
  );
  roots.forEach(attach);
  return roots;
}

function LocationTreeRow({
  node,
  depth,
  onViewQuants,
  t,
}: {
  node: LocationTreeNode;
  depth: number;
  onViewQuants: (locationId: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [open, setOpen] = useState(depth < 2);
  const label = String(node.row.completeName ?? node.row.name ?? node.id);
  const usage = String(node.row.usage ?? '');

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            className="text-muted-foreground"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform',
                open && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate font-medium">{label}</span>
        {usage ? (
          <span className="text-xs text-muted-foreground capitalize">
            {usage}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('inventory.locationTree.quantCount', { count: node.quantCount })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onViewQuants(node.id)}
        >
          {t('inventory.locationTree.viewQuants')}
        </Button>
      </div>
      {open && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <LocationTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              onViewQuants={onViewQuants}
              t={t}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function LocationHierarchyPanel({
  locations,
  quants,
  onViewQuants,
}: {
  locations: QueryRows;
  quants: QueryRows;
  onViewQuants: (locationId: string) => void;
}) {
  const { t } = useTranslation();
  const tree = useMemo(
    () => buildLocationTree(locations, quants),
    [locations, quants],
  );

  return (
    <div className="space-y-4 p-1">
      <div>
        <h2 className="text-lg font-semibold">
          {t('inventory.locationTree.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('inventory.locationTree.description')}
        </p>
      </div>
      {tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('inventory.stockLocations.emptyMessage')}
        </p>
      ) : (
        <ul className="rounded-lg border border-border p-2">
          {tree.map((node) => (
            <LocationTreeRow
              key={node.id}
              node={node}
              depth={0}
              onViewQuants={onViewQuants}
              t={t}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function QualityAlertsPanel({
  organizationId,
  operatingCompanyId,
  selectedCompanyId,
  onAssignAlert,
  onSolveAlert,
}: {
  organizationId: number;
  operatingCompanyId: bigint;
  selectedCompanyId?: bigint;
  onAssignAlert: (alertId: ScalarId) => void;
  onSolveAlert: (alertId: ScalarId) => void;
}) {
  const { t } = useTranslation();
  const orgId = BigInt(organizationId);
  const openAlert = useOpenQualityAlert(orgId, selectedCompanyId);
  const solveAlert = useSolveQualityAlert(orgId, selectedCompanyId);
  const cancelAlert = useCancelQualityAlert(orgId, operatingCompanyId);

  const { data: alerts = [], isLoading } = useQualityAlerts(orgId);

  const tableConfig = useMemo(() => {
    const base = qualityAlertsTableConfig(t);
    if (base.view.mode !== 'table') return base;
    return {
      ...base,
      view: {
        ...base.view,
        actions: [
          {
            id: 'open-alert',
            label: t('inventory.qualityAlerts.actions.open'),
            requiresSelection: true,
            isApplicable: (rows) =>
              rows.every((row) => ['draft'].includes(rowState(row, 'state'))),
            successMessage: t('common.actionCompleted', {
              action: t('inventory.qualityAlerts.actions.open'),
            }),
            onClick: async (rows: Record<string, unknown>[]) => {
              const id = rows[0]?.id as ScalarId | undefined;
              if (id != null) await openAlert.mutateAsync(id);
            },
          },
          {
            id: 'assign-alert',
            label: t('inventory.qualityAlerts.actions.assign'),
            requiresSelection: true,
            onClick: (rows: Record<string, unknown>[]) => {
              const id = rows[0]?.id as ScalarId | undefined;
              if (id != null) onAssignAlert(id);
            },
          },
          {
            id: 'solve-alert',
            label: t('inventory.qualityAlerts.actions.solve'),
            requiresSelection: true,
            isApplicable: (rows) =>
              rows.every(
                (row) =>
                  !['solved', 'cancelled'].includes(rowState(row, 'state')),
              ),
            onClick: (rows: Record<string, unknown>[]) => {
              const id = rows[0]?.id as ScalarId | undefined;
              if (id != null) onSolveAlert(id);
            },
          },
          {
            id: 'cancel-alert',
            label: t('inventory.qualityAlerts.actions.cancel'),
            variant: 'destructive' as const,
            requiresSelection: true,
            isApplicable: (rows) =>
              rows.every(
                (row) =>
                  !['solved', 'cancelled'].includes(rowState(row, 'state')),
              ),
            successMessage: t('common.actionCompleted', {
              action: t('inventory.qualityAlerts.actions.cancel'),
            }),
            onClick: async (rows: Record<string, unknown>[]) => {
              const id = rows[0]?.id as ScalarId | undefined;
              if (id != null) await cancelAlert.mutateAsync({ alertId: id });
            },
          },
        ],
      },
    };
  }, [t, openAlert, cancelAlert, onAssignAlert, onSolveAlert]);

  return (
    <div className="space-y-4 p-1 min-h-[320px]">
      <div className="flex items-start gap-3">
        <Package className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold">
            {t('inventory.qualityAlerts.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('inventory.qualityAlerts.description')}
          </p>
        </div>
      </div>
      {alerts.length === 0 && !isLoading ? (
        <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">
          {t('inventory.qualityAlerts.emptyHint')}
        </p>
      ) : null}
      <EntityView
        config={tableConfig}
        data={alerts as Record<string, unknown>[]}
      />
    </div>
  );
}
