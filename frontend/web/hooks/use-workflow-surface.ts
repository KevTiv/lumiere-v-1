'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { buildModuleTabHref, showWorkflowToast, useRBAC } from '@lumiere/ui';
import { useTranslation } from '@lumiere/i18n';
import {
  resolveRecordLocation,
  type ErpRecordRef,
  type TransitionEvent,
  type TransitionNotice,
} from '@lumiere/erp-workflows';
import { phCapture } from '@/lib/posthog-browser';

/**
 * The web surface for workflow completion: typed-outcome toasts and record-ref navigation.
 * Every module client migrating actions onto `@lumiere/erp-workflows` reuses this.
 *
 * Failures are explained by kind: what happened, whether anything changed, and whether the list
 * was refreshed. A failure that is safe to re-issue gets a Retry action; an unknown outcome
 * never does. Every run is also logged (identifiers and outcomes only) for diagnosing failures.
 */
export function useWorkflowSurface(options: { organizationId?: number | bigint } = {}) {
  const { organizationId } = options;
  const { t } = useTranslation();
  const router = useRouter();
  const { checkPermission } = useRBAC();

  const notify = useCallback(
    (notice: TransitionNotice) => {
      if (notice.kind === 'error' && notice.error) {
        const { kind, message } = notice.error;
        const hint = t(`erpWorkflow.hints.${kind}`, { defaultValue: '' });
        // A transport failure without a response carries no useful message of its own.
        const detail = kind === 'outcome_unknown' ? '' : message;
        const retry = notice.retry;
        showWorkflowToast({
          kind: 'error',
          title: t(`erpWorkflow.errors.${kind}`),
          description:
            [detail, hint, notice.refreshed ? t('erpWorkflow.refreshed') : '']
              .filter(Boolean)
              .join(' ') || undefined,
          action: retry
            ? {
                label: t('erpWorkflow.retry'),
                // A failed retry reports itself through the same notice path.
                onClick: () => void retry().catch(() => undefined),
              }
            : undefined,
        });
        return;
      }
      showWorkflowToast(
        notice.kind === 'info'
          ? { kind: 'info', title: t('erpWorkflow.approvalPending') }
          : { kind: 'success', title: t('erpWorkflow.applied') },
      );
    },
    [t],
  );

  const navigate = useCallback(
    (ref: ErpRecordRef) => {
      // Same rule the navigation catalog uses: read on the module resource.
      const location = resolveRecordLocation(ref, {
        canAccess: (module) => checkPermission(`module:${module}`, 'read').allowed,
      });
      if (location) router.push(buildModuleTabHref(location.module, location.tab, location.filter));
    },
    [router, checkPermission],
  );

  const record = useCallback(
    (event: TransitionEvent) => {
      phCapture('workflow_transition', {
        ...event,
        ...(organizationId != null ? { organization_id: String(organizationId) } : {}),
      });
    },
    [organizationId],
  );

  return { notify, navigate, record };
}
