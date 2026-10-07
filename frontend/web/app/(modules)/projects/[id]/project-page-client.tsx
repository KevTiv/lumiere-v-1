'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Clock, ListTodo, MoreHorizontal } from 'lucide-react';
import { useTranslation } from '@lumiere/i18n';
import {
  Button,
  EntityDetail,
  EntityView,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  FormModal,
  KanbanBoard,
  MissingOrganization,
  RecordAuditTab,
  RecordChatter,
  RecordPage,
  SmartButtons,
  buildModuleTabHref,
  editProjectForm,
  mergeSelectOptionsForFields,
  newProjectForm,
  projectsTableConfig,
  tasksTableConfig,
  timesheetsTableConfig,
  type FormConfig,
} from '@lumiere/ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@lumiere/ui/components/alert-dialog';
import { Badge } from '@lumiere/ui/components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@lumiere/ui/components/dropdown-menu';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { useContacts } from '@lumiere/query-hooks/hooks/crm';
import { usePricelists } from '@lumiere/query-hooks/hooks/sales';
import {
  useCreateProject,
  useProjects,
  useSetProjectActive,
  useTasks,
  useTimesheets,
  useUpdateProject,
  useUpdateTaskState,
} from '@lumiere/query-hooks/hooks/projects';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { contactRowsToPartnerSelectOptions, pricelistRowsToSelectOptions } from '@/lib/form-lookup';
import { useRecordNavigation } from '@/hooks/use-record-navigation';
import { useProjectsModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { projectsParamsToJson, toCreateProjectParams, toUpdateProjectParams } from '@/lib/projects-create-params';
import { archiveAction, archiveTargetActive, duplicateName } from '@/lib/record-standard-actions';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import {
  TASK_BOARD_STATES,
  getProjectFieldValue,
  hoursLogged,
  projectStatusTag,
  rowsOfProject,
  taskBoardState,
} from '../project-record';

interface ProjectPageClientProps {
  projectId: string;
  initialProjects?: unknown[];
  initialTasks?: unknown[];
  initialTimesheets?: unknown[];
  initialPricelists?: unknown[];
  organizationId?: number;
}

type Row = Record<string, unknown>;

const TAB_IDS = ['overview', 'tasks', 'board', 'timesheets', 'discussion', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export function ProjectPageClient(props: ProjectPageClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <ProjectPageLoaded {...props} organizationId={props.organizationId} />;
}

function ProjectPageLoaded({
  projectId,
  initialProjects,
  initialTasks,
  initialTimesheets,
  initialPricelists,
  organizationId,
}: ProjectPageClientProps & { organizationId: number }) {
  useProjectsModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { orgId } = orgBigInts(organizationId);
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const { data: projects = [], isLoading } = useProjects(orgId, initialProjects as never);
  const { data: tasks = [] } = useTasks(orgId, initialTasks as never);
  const { data: timesheets = [] } = useTimesheets(orgId, initialTimesheets as never);
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists as never);
  const { data: contacts = [] } = useContacts(orgId);
  const updateProject = useUpdateProject(orgId, operatingCompanyId);
  const updateTaskState = useUpdateTaskState(orgId);
  const setProjectActive = useSetProjectActive(orgId);
  const createProject = useCreateProject(orgId, operatingCompanyId);

  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const project = useMemo(
    () => (projects as unknown as Row[]).find((row) => String(row.id) === projectId),
    [projects, projectId],
  );
  const ownTasks = useMemo(() => rowsOfProject(tasks as unknown as Row[], projectId), [tasks, projectId]);
  const ownTimesheets = useMemo(() => rowsOfProject(timesheets as unknown as Row[], projectId), [timesheets, projectId]);

  const navigation = useRecordNavigation<Row>({
    rows: projects as unknown as Row[],
    currentId: projectId,
    basePath: '/projects',
    labelOf: (row) => String(row.name || row.id),
  });

  const requestedTab = searchParams.get('tab');
  const activeTab: TabId = (TAB_IDS as readonly string[]).includes(requestedTab ?? '')
    ? (requestedTab as TabId)
    : 'overview';
  const setActiveTab = useCallback(
    (tab: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  if (!project) {
    if (isLoading) {
      return (
        <div className="space-y-4" data-testid="project-page-loading">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <Empty data-testid="project-page-not-found">
        <EmptyHeader>
          <EmptyTitle>{t('projects.page.notFound', { defaultValue: 'Project not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('projects.page.notFoundHint', { defaultValue: 'It may have been deleted, or belong to another organization.' })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={buildModuleTabHref('projects', 'projects')} />} nativeButton={false}>
            {t('projects.page.backToProjects', { defaultValue: 'Back to projects' })}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const id = BigInt(projectId);
  const label = String(project.name || '').trim() || `#${projectId}`;
  const status = projectStatusTag(project.lastUpdateStatus);
  const hours = hoursLogged(ownTimesheets);
  const partnerId = project.partnerId ?? project.partner_id;
  const partner = (contacts as unknown as Row[]).find((row) => String(row.id) === String(partnerId));

  const table = projectsTableConfig(t);
  const columns = table.view.mode === 'table' ? table.view.columns : [];
  const detailConfig = {
    mode: 'detail' as const,
    sections: [
      {
        id: 'project',
        fields: columns
          .filter((column) => column.key !== 'name')
          .map(({ width: _width, ...field }) =>
            field.key === 'partnerId' ? { ...field, render: () => String(partner?.name ?? partner?.displayName ?? partnerId ?? '—') } : field,
          ),
      },
    ],
  };

  const stateLabels: Record<string, string> = {
    InProgress: t('projects.tasks.states.InProgress', { defaultValue: 'In progress' }),
    ChangesRequested: t('projects.tasks.states.ChangesRequested', { defaultValue: 'Changes requested' }),
    Approved: t('projects.tasks.states.Approved', { defaultValue: 'Approved' }),
    Done: t('projects.tasks.states.Done', { defaultValue: 'Done' }),
    Cancelled: t('projects.tasks.states.Cancelled', { defaultValue: 'Cancelled' }),
  };
  const boardColumns = TASK_BOARD_STATES.map((state, index) => ({
    id: state,
    title: stateLabels[state] ?? state,
    colorClass: ['bg-info', 'bg-warning', 'bg-category-3', 'bg-success', 'bg-destructive'][index],
  }));

  const base = mergeSelectOptionsForFields(editProjectForm(t), {
    pricelistId: pricelistRowsToSelectOptions(pricelists as never),
    partnerId: [{ value: '', label: '—' }, ...contactRowsToPartnerSelectOptions(contacts as never)],
  });
  const editForm: FormConfig = {
    ...base,
    sections: base.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({ ...field, defaultValue: getProjectFieldValue(project, field.name) }) as typeof field),
    })) as typeof base.sections,
  };

  const archive = archiveAction('projects', project);
  const archiveLabel =
    archive === 'unarchive'
      ? t('projects.page.unarchive', { defaultValue: 'Unarchive' })
      : t('projects.page.archive', { defaultValue: 'Archive' });
  const duplicateBase = mergeSelectOptionsForFields(newProjectForm(t), {
    pricelistId: pricelistRowsToSelectOptions(pricelists as never),
    partnerId: [{ value: '', label: '—' }, ...contactRowsToPartnerSelectOptions(contacts as never)],
  });
  const duplicateForm: FormConfig = {
    ...duplicateBase,
    sections: duplicateBase.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        const value = field.name === 'name' ? duplicateName('projects', project.name) : getProjectFieldValue(project, field.name);
        return { ...field, defaultValue: value } as typeof field;
      }),
    })) as typeof duplicateBase.sections,
  };
  const changeActive = (action: 'archive' | 'unarchive') =>
    setProjectActive.mutate(
      { projectId: id, active: archiveTargetActive(action) },
      {
        onSuccess: () => {
          showWorkflowToast({ kind: 'success', title: action === 'archive' ? t('projects.page.archived', { defaultValue: 'Project archived' }) : t('projects.page.unarchived', { defaultValue: 'Project unarchived' }), description: label });
          if (action === 'archive') router.push(buildModuleTabHref('projects', 'projects'));
        },
        onError: (error) => showWorkflowToast({ kind: 'error', title: t('common.error.title'), description: error.message }),
      },
    );

  return (
    <>
      <RecordPage
        testIdPrefix="project"
        breadcrumbs={[
          { label: t('nav.projects', { defaultValue: 'Projects' }), href: '/projects' },
          { label: t('projects.projects.title'), href: buildModuleTabHref('projects', 'projects') },
          { label },
        ]}
        title={label}
        subtitle={[partner ? String(partner.name ?? '') : '', `${hours} h`].filter(Boolean).join(' · ')}
        badge={status ? <Badge variant={status === 'Cancelled' ? 'destructive' : 'secondary'}>{status}</Badge> : undefined}
        navigation={navigation}
        smartButtons={
          <SmartButtons
            testIdPrefix="project"
            buttons={[
              {
                id: 'tasks',
                label: t('projects.tasks.title', { defaultValue: 'Tasks' }),
                count: ownTasks.length,
                icon: <ListTodo className="h-4 w-4" />,
                onClick: () => setActiveTab('tasks'),
              },
              {
                id: 'timesheets',
                label: t('projects.timesheets.title', { defaultValue: 'Timesheets' }),
                count: ownTimesheets.length,
                icon: <Clock className="h-4 w-4" />,
                onClick: () => setActiveTab('timesheets'),
              },
            ]}
          />
        }
        actions={
          <>
            <Button size="sm" data-testid="project-edit" onClick={() => setEditing(true)}>
              {t('projects.page.edit', { defaultValue: 'Edit' })}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="project-more-actions">
                  <MoreHorizontal className="mr-1 h-4 w-4" />
                  {t('projects.page.moreActions', { defaultValue: 'More' })}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="project-action-duplicate" onSelect={() => setDuplicating(true)}>
                  {t('projects.page.duplicate', { defaultValue: 'Duplicate' })}
                </DropdownMenuItem>
                {archive ? (
                  <DropdownMenuItem
                    data-testid={`project-action-${archive}`}
                    disabled={setProjectActive.isPending}
                    onSelect={() => (archive === 'archive' ? setConfirmArchive(true) : changeActive('unarchive'))}
                  >
                    {archiveLabel}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('common.overview', { defaultValue: 'Overview' }),
            content: <EntityDetail config={detailConfig} data={project} />,
          },
          {
            id: 'tasks',
            label: t('projects.tasks.title', { defaultValue: 'Tasks' }),
            content: (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" render={<Link href="/tasks" />} nativeButton={false} data-testid="project-open-tasks-board">
                    {t('projects.page.openTasksBoard', { defaultValue: 'Open tasks board' })}
                  </Button>
                </div>
                <EntityView config={{ ...tasksTableConfig(t), title: '', description: undefined }} data={ownTasks} useCard={false} />
              </div>
            ),
          },
          {
            id: 'board',
            label: t('projects.page.board', { defaultValue: 'Board' }),
            content: (
              <div data-testid="project-board">
                <KanbanBoard
                  columns={boardColumns}
                  items={ownTasks}
                  getItemId={(item) => String(item.id ?? '')}
                  getColumnId={(item) => taskBoardState(item)}
                  renderCard={(item) => (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">{String(item.name ?? `#${String(item.id)}`)}</p>
                    </div>
                  )}
                  onMove={async ({ itemId, toColumnId }) => {
                    try {
                      await updateTaskState.mutateAsync({ taskId: itemId, state: toColumnId });
                    } catch (error) {
                      showWorkflowToast({
                        kind: 'error',
                        title: t('common.error.title'),
                        description: error instanceof Error ? error.message : String(error),
                      });
                    }
                  }}
                />
              </div>
            ),
          },
          {
            id: 'timesheets',
            label: t('projects.timesheets.title', { defaultValue: 'Timesheets' }),
            content: (
              <EntityView config={{ ...timesheetsTableConfig(t), title: '', description: undefined }} data={ownTimesheets} useCard={false} />
            ),
          },
          {
            id: 'discussion',
            label: t('projects.page.discussion', { defaultValue: 'Discussion' }),
            content: (
              <div className="max-w-2xl" data-testid="project-discussion">
                <RecordChatter organizationId={organizationId} resModel="project_project" resId={id} recordTitle={label} />
              </div>
            ),
          },
          {
            id: 'audit',
            label: t('common.audit', { defaultValue: 'Audit' }),
            content: <RecordAuditTab tableName="project_project" recordId={projectId} />,
          },
        ]}
      />

      {editing ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditing(false);
              setEditError(null);
            }
          }}
          config={editForm}
          isPending={updateProject.isPending}
          closeOnSubmit={false}
          submitError={editError}
          onSubmit={async (formData) => {
            setEditError(null);
            const params = toUpdateProjectParams(formData);
            if (!params) {
              setEditError(t('common.validation.required'));
              return;
            }
            try {
              await updateProject.mutateAsync({ projectId, params: projectsParamsToJson(params) });
              setEditing(false);
            } catch (error) {
              setEditError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      ) : null}

      {duplicating ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setDuplicating(false);
              setDuplicateError(null);
            }
          }}
          config={duplicateForm}
          isPending={createProject.isPending}
          closeOnSubmit={false}
          submitError={duplicateError}
          onSubmit={async (formData) => {
            setDuplicateError(null);
            const params = toCreateProjectParams(formData, pricelists as unknown as Row[], operatingCompanyId);
            if (!params) {
              setDuplicateError(t('common.validation.required'));
              return;
            }
            try {
              await createProject.mutateAsync(projectsParamsToJson(params));
              setDuplicating(false);
              showWorkflowToast({
                kind: 'success',
                title: t('projects.page.duplicated', { defaultValue: 'Project duplicated' }),
                description: String(formData.name ?? ''),
              });
            } catch (error) {
              setDuplicateError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
      ) : null}

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent data-testid="project-archive-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('projects.page.archiveConfirm', { defaultValue: 'Archive this project?' })}</AlertDialogTitle>
            <AlertDialogDescription>{label}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('erpWorkflow.confirm.dismiss')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmArchive(false);
                changeActive('archive');
              }}
            >
              {t('projects.page.archive', { defaultValue: 'Archive' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
