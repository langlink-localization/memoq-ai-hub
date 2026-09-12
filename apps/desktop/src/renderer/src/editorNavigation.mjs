// Shared by drawer dismissal and page navigation. A pending write cannot be
// discarded; an unsaved draft leaves only after an explicit confirmation.
export function requestEditorDeparture({ dirty, busy, name, modal, t, proceed }) {
  if (busy) return false;
  if (!dirty) { proceed(); return true; }
  modal.confirm({
    title: t('navigation.unsavedTitle'),
    content: t('navigation.unsavedDescription', { name }),
    okText: t('navigation.discardAndContinue'),
    cancelText: t('navigation.stay'),
    okButtonProps: { danger: true },
    onOk: proceed
  });
  return false;
}
