import { AgentPeopleMenu } from './AgentPeopleMenu'

/** Top-right share zone: collaborators + AI agent (when enabled) via synced document meta. */
export function AgentSharePanel() {
	return (
		<div className="tlui-share-zone" draggable={false}>
			<AgentPeopleMenu />
		</div>
	)
}
