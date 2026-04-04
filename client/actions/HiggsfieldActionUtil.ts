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
			if (!action.prompt?.trim()) return null
			return action
		}

		/** Resolve a shapeId string to a canvas src URL, or null if not an image. */
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
			if (src.startsWith('https://') || src.startsWith('http://')) return src
			if (src.startsWith('/')) return `${window.location.origin}${src}`
			return null
		}

		/** Find the first image shape on the canvas and return its URL, or null. */
		private getAnyImageUrl(): string | null {
			const { editor } = this
			// Prefer selected image, then any visible image
			const candidates = [
				...editor.getSelectedShapes(),
				...editor.getCurrentPageShapes(),
			]
			for (const shape of candidates) {
				if (shape.type !== 'image') continue
				const url = this.getImageUrlFromShapeId(shape.id.slice(6))
				if (url) return url
			}
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
				return
			}

			// video mode: resolve image URL
			let imageUrl: string | null = null

			if (action.sourceShapeId?.trim()) {
				imageUrl = this.getImageUrlFromShapeId(action.sourceShapeId.trim())
				if (!imageUrl) {
					console.warn('[Higgsfield] sourceShapeId not found, falling back to any image on canvas:', action.sourceShapeId)
				}
			}

			// Fallback: selected image or first image on canvas
			if (!imageUrl) {
				imageUrl = this.getAnyImageUrl()
			}

			if (!imageUrl) {
				agent.onError(new Error('Higgsfield video: no image found on canvas to animate. Generate a picture first.'))
				return
			}

			queueHiggsfieldVideo(editor, imageUrl, action.prompt, {
				onError: (e) => agent.onError(e),
			})
		}
	}
)
