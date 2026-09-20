'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { buildModuleTabHref, showWorkflowToast, useRBAC } from '@lumiere/ui';
import { useTranslation } from '@lumiere/i18n';
import { resolveRecordLocation, type ErpRecordRef, type TransitionNotice } from '@lumiere/erp-workflows';

/**
 * The web surface for workflow completion: typed-outcome toasts and record-ref navigation.
 * Every module client migrating actions onto `@lumiere/erp-workflows` reuses this.
 */
export function useWorkflowSurface() {
  const { t } = useTranslation();
  const router = useRouter();
  const { checkPermission } = useRBAC();

  const notify = useCallback(
    (notice: TransitionNotice) => {
      if (notice.kind === 'error' && notice.error) {
        showWorkflowToast({
          kind: 'error',
          title: t(`erpWorkflow.errors.${notice.error.kind}`),
          description: notice.error.message,
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

  return { notify, navigate };
}
