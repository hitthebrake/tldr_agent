export type HiggsfieldGenerationState = {
	active: boolean
	label: string
}

const defaultState: HiggsfieldGenerationState = { active: false, label: '' }

let state: HiggsfieldGenerationState = { ...defaultState }
/** Concurrent jobs (toolbar + agent) share one overlay until all finish. */
let activeJobCount = 0
const listeners = new Set<() => void>()

function emit() {
	for (const l of listeners) l()
}

export function getHiggsfieldGenerationState(): HiggsfieldGenerationState {
	return state
}

export function subscribeHiggsfieldGeneration(onChange: () => void): () => void {
	listeners.add(onChange)
	return () => listeners.delete(onChange)
}

function setGenerationState(patch: Partial<HiggsfieldGenerationState>) {
	state = { ...state, ...patch }
	emit()
}

export type HiggsfieldJobHooks = {
	onSuccess?: () => void
	onError?: (error: unknown) => void
}

/**
 * Shows the global Higgsfield loading UI and runs async work without blocking the caller.
 * Supports overlapping jobs (e.g. agent + toolbar) via a refcount.
 */
export function runHiggsfieldJob(
	label: string,
	work: () => Promise<void>,
	hooks?: HiggsfieldJobHooks
): void {
	activeJobCount++
	setGenerationState({ active: true, label })
	void work()
		.then(() => {
			hooks?.onSuccess?.()
		})
		.catch((e) => {
			hooks?.onError?.(e)
			console.error('[Higgsfield]', e)
		})
		.finally(() => {
			activeJobCount = Math.max(0, activeJobCount - 1)
			if (activeJobCount === 0) {
				setGenerationState({ active: false, label: '' })
			}
		})
}
