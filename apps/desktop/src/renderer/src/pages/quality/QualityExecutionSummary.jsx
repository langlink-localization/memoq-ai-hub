import { Descriptions, Tag } from 'antd';
import { useI18n } from '../../i18n';

function statusColor(status) {
  if (status === 'complete' || status === 'cache-hit') return 'success';
  if (status === 'failed' || status === 'circuit-open') return 'error';
  if (status === 'cancelled' || status === 'stale') return 'warning';
  return 'default';
}

export default function QualityExecutionSummary({ execution, compact = false }) {
  const { t } = useI18n();
  if (!execution) return null;
  const deterministic = execution.deterministic || {};
  const ai = execution.ai || {};
  const aiRoute = [ai.providerId, ai.model].filter(Boolean).join(' / ') || '-';

  return (
    <Descriptions
      bordered
      size="small"
      column={compact ? 1 : { xs: 1, sm: 2, lg: 3 }}
      title={t('quality.executionSummary')}
      items={[
        {
          key: 'deterministic',
          label: t('quality.deterministicChecks'),
          children: <Tag color={statusColor(deterministic.status)}>{t(`quality.executionStatus.${deterministic.status || 'not-run'}`)}</Tag>
        },
        { key: 'deterministicFindings', label: t('quality.deterministicFindings'), children: deterministic.findingCount ?? 0 },
        { key: 'deterministicDuration', label: t('quality.duration'), children: `${deterministic.durationMs ?? 0} ms` },
        {
          key: 'ai',
          label: t('quality.aiChecks'),
          children: <Tag color={statusColor(ai.status)}>{t(`quality.executionStatus.${ai.cacheHit ? 'cache-hit' : ai.status || (ai.requested ? 'not-run' : 'not-requested')}`)}</Tag>
        },
        { key: 'route', label: t('quality.providerModel'), children: aiRoute },
        { key: 'aiDuration', label: t('quality.duration'), children: ai.executed || ai.cacheHit ? `${ai.durationMs ?? 0} ms` : '-' },
        { key: 'candidate', label: t('quality.candidateFindings'), children: ai.candidateCount ?? 0 },
        { key: 'displayed', label: t('quality.displayedFindings'), children: ai.displayedCount ?? 0 },
        { key: 'filtered', label: t('quality.filteredFindings'), children: ai.filteredCount ?? 0 }
      ]}
    />
  );
}
