import { useCallback, useSyncExternalStore } from 'react'
import { TldrawUiToolbarButton, useEditor, useToasts } from 'tldraw'
import { getSelectedImageUrl, queueHiggsfieldVideo } from '../higgsfield/higgsfieldClient'
import {
	getHiggsfieldGenerationState,
	subscribeHiggsfieldGeneration,
} from '../higgsfield/higgsfieldGenerationStore'

/** Animate the selected canvas image with Higgsfield. No prompts — just select an image and click. */
export function HiggsfieldToolbarItem() {
	const editor = useEditor()
	const { addToast } = useToasts()
	const busy = useSyncExternalStore(
		subscribeHiggsfieldGeneration,
		() => getHiggsfieldGenerationState().active,
		() => getHiggsfieldGenerationState().active
	)

	const run = useCallback(() => {
		const imageUrl = getSelectedImageUrl(editor)
		if (!imageUrl) {
			addToast({
				severity: 'error',
				title: 'Select an image first',
				description: 'Click an image on the canvas, then press Animate.',
			})
			return
		}
		queueHiggsfieldVideo(editor, imageUrl, 'animate', {
			onSuccess: () =>
				addToast({ severity: 'success', title: 'Video ready', description: 'Placed on the canvas.' }),
			onError: (e) =>
				addToast({
					severity: 'error',
					title: 'Animation failed',
					description: e instanceof Error ? e.message : String(e),
				}),
		})
	}, [addToast, editor])

	return (
		<TldrawUiToolbarButton
			type="tool"
			title="Animate selected image with Higgsfield"
			disabled={busy}
			className="higgsfield-toolbar-trigger"
			onClick={run}
		>
			<img
				className="higgsfield-toolbar-logo"
				src="/higgsfield-mark.svg"
				width={18}
				height={18}
				alt=""
				draggable={false}
			/>
		</TldrawUiToolbarButton>
	)
}
