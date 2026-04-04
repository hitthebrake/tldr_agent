import { TLImageAsset, TLImageShape } from 'tldraw'
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
				if (!action.sourceShapeId?.trim()) return null
			}
			if (!action.prompt?.trim()) return null
			return action
		}

		/** Resolve a shape ID to the image's src URL using the editor's asset store. */
		private getImageUrlFromShapeId(shapeId: string): string | null {
			const { editor } = this
			const realId = `shape:${shapeId.replace(/^shape:/, '')}` as any
			const shape = editor.getShape(realId)
			if (!shape || shape.type !== 'image') return null
			const assetId = (shape as TLImageShape).props.assetId
			if (!assetId) return null
			const asset = editor.getAsset(assetId)
			if (!asset || asset.type !== 'image') return null
			const src = (asset as TLImageAsset).props.src
			if (!src) return null
			if (src.startsWith('https://')) return src
			if (src.startsWith('/')) return `${window.location.origin}${src}`
			return null
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
				const imageUrl = this.getImageUrlFromShapeId(action.sourceShapeId!)
				if (!imageUrl) {
					agent.onError(new Error(`Could not find image URL for shape: ${action.sourceShapeId}`))
					return
				}
				queueHiggsfieldVideo(editor, imageUrl, action.prompt, {
					onError: (e) => agent.onError(e),
				})
			}
		}
	}
)
