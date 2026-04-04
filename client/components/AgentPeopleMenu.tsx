import { useContainer, useEditor, usePeerIds, useValue } from '@tldraw/editor'
import { Popover as _Popover } from 'radix-ui'
import {
	OfflineIndicator,
	PORTRAIT_BREAKPOINT,
	TldrawUiButton,
	TldrawUiIcon,
	TldrawUiRow,
	useBreakpoint,
	useCollaborationStatus,
	useMenuIsOpen,
	useTranslation,
} from 'tldraw'
import { PeopleMenuAvatar } from './people-menu/PeopleMenuAvatar'
import { PeopleMenuItem } from './people-menu/PeopleMenuItem'
import { PeopleMenuMore } from './people-menu/PeopleMenuMore'
import { UserPresenceEditor } from './people-menu/UserPresenceEditor'

const AGENT_COLOR = '#8B5CF6'

/**
 * Same as tldraw's PeopleMenu, but when `agentActive` is set in synced document meta
 * the AI appears as another participant in the avatar strip and in the people list.
 */
export function AgentPeopleMenu() {
	const msg = useTranslation()
	const container = useContainer()
	const editor = useEditor()

	const userIds = usePeerIds()
	const userColor = useValue('user', () => editor.user.getColor(), [editor])
	const userName = useValue('user', () => editor.user.getName(), [editor])
	const agentActive = useValue(
		'agentActive',
		() => !!(editor.getDocumentSettings().meta?.agentActive),
		[editor]
	)

	const [isOpen, onOpenChange] = useMenuIsOpen('people menu')
	const breakpoint = useBreakpoint()
	const maxAvatars = breakpoint <= PORTRAIT_BREAKPOINT.MOBILE_XS ? 1 : 5

	const collaborationStatus = useCollaborationStatus()

	if (collaborationStatus === 'offline') {
		return <OfflineIndicator />
	}

	if (!userIds.length && !agentActive) {
		return null
	}

	const showSelfAvatar = userIds.length > 0 || agentActive

	return (
		<_Popover.Root onOpenChange={onOpenChange} open={isOpen}>
			<_Popover.Trigger dir="ltr" asChild>
				<button className="tlui-people-menu__avatars-button" title={msg('people-menu.title')}>
					<div className="tlui-people-menu__avatars">
						{userIds.slice(-maxAvatars).map((userId) => (
							<PeopleMenuAvatar key={userId} userId={userId} />
						))}
						{agentActive && (
							<div
								className="tlui-people-menu__avatar tlui-people-menu__avatar--agent"
								title="AI Agent"
							>
								<span className="tlui-people-menu__avatar-agent-glyph">✦</span>
							</div>
						)}
						{showSelfAvatar && (
							<div
								className="tlui-people-menu__avatar"
								style={{
									backgroundColor: userColor,
								}}
							>
								{userName?.[0] ?? ''}
							</div>
						)}
						{userIds.length > maxAvatars && (
							<PeopleMenuMore count={userIds.length - maxAvatars} />
						)}
					</div>
				</button>
			</_Popover.Trigger>
			<_Popover.Portal container={container}>
				<_Popover.Content
					dir="ltr"
					className="tlui-menu"
					side="bottom"
					sideOffset={2}
					collisionPadding={4}
				>
					<div className="tlui-people-menu__wrapper">
						<div className="tlui-people-menu__section">
							<UserPresenceEditor />
						</div>
						{(userIds.length > 0 || agentActive) && (
							<div className="tlui-people-menu__section">
								{userIds.map((userId) => (
									<PeopleMenuItem key={userId + '_presence'} userId={userId} />
								))}
								{agentActive && <AgentPeopleMenuRow />}
							</div>
						)}
					</div>
				</_Popover.Content>
			</_Popover.Portal>
		</_Popover.Root>
	)
}

function AgentPeopleMenuRow() {
	const msg = useTranslation()
	return (
		<TldrawUiRow className="tlui-people-menu__item" data-agent="true">
			<TldrawUiButton type="menu" className="tlui-people-menu__item__button" disabled>
				<TldrawUiIcon label={msg('people-menu.avatar-color')} icon="color" color={AGENT_COLOR} />
				<div className="tlui-people-menu__name">AI Agent</div>
			</TldrawUiButton>
		</TldrawUiRow>
	)
}
