import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors, radii, spacing, typography } from '../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../theme/themed-styles'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'

export function MobileNativeChatApprovalNotes({
  canComment,
  canEditPlan,
  comment,
  onComment,
  editedPlan,
  onEditPlan,
  disabled
}: {
  canComment: boolean
  canEditPlan: boolean
  comment: string
  onComment: (text: string) => void
  editedPlan: string | null
  onEditPlan: (text: string | null) => void
  disabled: boolean
}): React.JSX.Element | null {
  const t = useMobileTranslation()
  if (!canComment && !canEditPlan) {
    return null
  }
  return (
    <View style={styles.fields}>
      {canComment ? (
        <TextInput
          accessibilityLabel={t('chat.permission.comment', 'Comment')}
          placeholder={t(
            'chat.permission.commentPlaceholder',
            'Add a comment for the agent (optional)'
          )}
          placeholderTextColor={colors.textSecondary}
          value={comment}
          onChangeText={onComment}
          editable={!disabled}
          multiline
          style={styles.field}
        />
      ) : null}
      {canEditPlan ? (
        <>
          {editedPlan !== null ? (
            <TextInput
              accessibilityLabel={t('chat.permission.editedPlan', 'Edited plan')}
              value={editedPlan}
              onChangeText={onEditPlan}
              editable={!disabled}
              multiline
              style={[styles.field, styles.plan]}
            />
          ) : null}
          <Pressable
            disabled={disabled}
            accessibilityRole="button"
            onPress={() => onEditPlan(editedPlan === null ? '' : null)}
            style={styles.action}
          >
            <Text style={styles.actionText}>
              {editedPlan === null
                ? t('chat.permission.editPlan', 'Edit plan')
                : t('chat.permission.discardEdits', 'Discard edits')}
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  fields: { gap: spacing.sm },
  field: {
    color: colors.textPrimary,
    backgroundColor: colors.bgRaised,
    borderColor: colors.borderSubtle,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.control,
    padding: spacing.sm,
    fontSize: typography.bodySize,
    minHeight: 44,
    textAlignVertical: 'top'
  },
  plan: { fontFamily: typography.monoFamily, maxHeight: 160 },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { color: colors.textSecondary, fontSize: typography.metaSize }
}))
