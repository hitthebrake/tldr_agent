import { HiggsfieldAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { queueHiggsfieldPicture, queueHiggsfieldVideo } from '../higgsfield/higgsfieldClient'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const HiggsfieldActionUtil = registerActionUtil(
	class HiggsfieldActionUtil extends AgentActionUtil<HiggsfieldAction> {
		static override type = 'higgsfield' as const

		override getInfo(action: Streaming<HiggsfieldAction>) {
			const kind = action.mode === 'video' ? 'video' : 'picture'
			const description = action.complete
				? `Queued Higgsfield ${kind} (runs in background)`
				: `Queue Higgsfield ${kind}`
			return {
				icon: 'search' as const,
				description,
			}
		}

		override sanitizeAction(action: Streaming<HiggsfieldAction>, _helpers: AgentHelpers) {
			if (!action.complete) return action
			if (action.mode === 'video') {
				const url = action.sourceImageUrl?.trim()
				if (!url) return null
			}
			if (!action.prompt?.trim()) return null
			return action
		}

		/**
		 * Fire-and-forget: start Higgsfield generation + placement in the background.
		 * The agent request does not wait for media to finish.
		 */
		override applyAction(action: Streaming<HiggsfieldAction>, _helpers: AgentHelpers) {
			if (!action.complete) return
			const { editor } = this
			const agent = this.agent

			if (action.mode === 'picture') {
				queueHiggsfieldPicture(editor, action.prompt, {
					onError: (e) => agent.onError(e),
				})
			} else {
				queueHiggsfieldVideo(editor, action.sourceImageUrl!.trim(), action.prompt, {
					onError: (e) => agent.onError(e),
				})
			}
		}
	}
)
