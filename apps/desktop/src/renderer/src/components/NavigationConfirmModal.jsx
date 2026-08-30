import { Alert, Button, Modal, Space, Typography } from 'antd';
import { useI18n } from '../i18n';

const { Text } = Typography;

// Confirmation dialog shown when navigating away from a dirty provider or
// profile editor. Offers stay / discard-and-continue / save-and-continue; the
// save path stays disabled while the provider connection check is stale.
export default function NavigationConfirmModal({
  pendingNavigation,
  navigationResolving,
  currentProvider,
  currentProfile,
  currentProviderConnectionMeta,
  onStay,
  onDiscardAndContinue,
  onSaveAndContinue
}) {
  const { t } = useI18n();

  return (
    <Modal
      title={t('navigation.unsavedTitle')}
      open={Boolean(pendingNavigation)}
      onCancel={onStay}
      closable={!navigationResolving}
      maskClosable={!navigationResolving}
      footer={[
        <Button key="stay" onClick={onStay} disabled={navigationResolving}>
          {t('navigation.stay')}
        </Button>,
        <Button key="discard" danger onClick={onDiscardAndContinue} disabled={navigationResolving}>
          {t('navigation.discardAndContinue')}
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={navigationResolving}
          disabled={pendingNavigation?.dirtyKind === 'provider' && currentProviderConnectionMeta.color !== 'green'}
          onClick={() => void onSaveAndContinue()}
        >
          {t('navigation.saveAndContinue')}
        </Button>
      ]}
    >
      <Space direction="vertical" size={8}>
        <Text>{t('navigation.unsavedDescription', {
          name: pendingNavigation?.dirtyKind === 'provider' ? currentProvider?.name || '-' : currentProfile?.name || '-'
        })}</Text>
        {pendingNavigation?.dirtyKind === 'provider' && currentProviderConnectionMeta.color !== 'green' ? (
          <Alert type="warning" showIcon message={t('navigation.providerMustTestBeforeSave')} />
        ) : null}
      </Space>
    </Modal>
  );
}
