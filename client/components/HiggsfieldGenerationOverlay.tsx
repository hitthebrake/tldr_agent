import { useSyncExternalStore } from 'react'
import {
	getHiggsfieldGenerationState,
	subscribeHiggsfieldGeneration,
} from '../higgsfield/higgsfieldGenerationStore'

export function HiggsfieldGenerationOverlay() {
	const { active, label } = useSyncExternalStore(
		subscribeHiggsfieldGeneration,
		getHiggsfieldGenerationState,
		getHiggsfieldGenerationState
	)

	if (!active) return null

	return (
		<div className="higgsfield-gen-overlay" role="status" aria-live="polite">
			<div className="higgsfield-gen-overlay__inner">
				<div className="higgsfield-gen-overlay__spinner" aria-hidden />
				<div className="higgsfield-gen-overlay__text">{label}</div>
				<div className="higgsfield-gen-overlay__bar" aria-hidden>
					<div className="higgsfield-gen-overlay__bar-indeterminate" />
				</div>
			</div>
		</div>
	)
}
