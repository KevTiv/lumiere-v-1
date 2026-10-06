'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Clock, ListTodo } from 'lucide-react';
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
  MissingOrganization,
  RecordAuditTab,
  RecordChatter,
  RecordPage,
  SmartButtons,
  buildModuleTabHref,
  editProjectForm,
  mergeSelectOptionsForFields,
  projectsTableConfig,
  tasksTableConfig,
  timesheetsTableConfig,
  type FormConfig,
} from '@lumiere/ui';
import { Badge } from '@lumiere/ui/components/badge';
import { Skeleton } from '@lumiere/ui/components/skeleton';
import { useContacts } from '@lumiere/query-hooks/hooks/crm';
import { usePricelists } from '@lumiere/query-hooks/hooks/sales';
import {
  useProjects,
  useTasks,
  useTimesheets,
  useUpdateProject,
} from '@lumiere/query-hooks/hooks/projects';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { contactRowsToPartnerSelectOptions, pricelistRowsToSelectOptions } from '@/lib/form-lookup';
import { useProjectsModuleSubscription } from '@/lib/module-subscription-hooks';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { projectsParamsToJson, toUpdateProjectParams } from '@/lib/projects-create-params';
import { getProjectFieldValue, hoursLogged, projectStatusTag, rowsOfProject } from '../project-record';

interface ProjectPageClientProps {
  projectId: string;
  initialProjects?: unknown[];
  initialTasks?: unknown[];
  initialTimesheets?: unknown[];
  initialPricelists?: unknown[];
  organizationId?: number;
}

type Row = Record<string, unknown>;

const TAB_IDS = ['overview', 'tasks', 'timesheets', 'discussion', 'audit'] as const;
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

  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const project = useMemo(
    () => (projects as unknown as Row[]).find((row) => String(row.id) === projectId),
    [projects, projectId],
  );
  const ownTasks = useMemo(() => rowsOfProject(tasks as unknown as Row[], projectId), [tasks, projectId]);
  const ownTimesheets = useMemo(() => rowsOfProject(timesheets as unknown as Row[], projectId), [timesheets, projectId]);

  const navigation = useMemo(() => {
    const sorted = [...(projects as unknown as Row[])].sort((a, b) => Number(BigInt(String(b.id)) - BigInt(String(a.id))));
    const index = sorted.findIndex((row) => String(row.id) === projectId);
    if (index === -1) return undefined;
    const link = (row: Row | undefined) =>
      row ? { href: `/projects/${String(row.id)}`, label: String(row.name || row.id) } : undefined;
    return { position: index + 1, total: sorted.length, previous: link(sorted[index - 1]), next: link(sorted[index + 1]) };
  }, [projects, projectId]);

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
          <Button size="sm" data-testid="project-edit" onClick={() => setEditing(true)}>
            {t('projects.page.edit', { defaultValue: 'Edit' })}
          </Button>
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
    </>
  );
}
