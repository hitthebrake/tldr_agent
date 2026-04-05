export type VoiceSuggestion = {
	description: string
	/** The local user's transcript that was sent */
	transcript: string
	/** Combined transcript from all users (shown when > 1 contributor) */
	combinedTranscript?: string
}

export type VoiceState = {
	listening: boolean
	/** Live transcript accumulating this interval */
	transcript: string
	suggestion: VoiceSuggestion | null
	processing: boolean
	error: string | null
	/** True while the manual WebRTC voice call is active — suppresses always-listening mode */
	callActive: boolean
}

const defaultState: VoiceState = {
	listening: false,
	transcript: '',
	suggestion: null,
	processing: false,
	error: null,
	callActive: false,
}

let state: VoiceState = { ...defaultState }
const listeners = new Set<() => void>()

function emit() {
	for (const l of listeners) l()
}

export function getVoiceState(): VoiceState {
	return state
}

export function subscribeVoiceState(cb: () => void): () => void {
	listeners.add(cb)
	return () => listeners.delete(cb)
}

export function setVoiceState(patch: Partial<VoiceState>) {
	state = { ...state, ...patch }
	emit()
}

export function resetVoiceState() {
	state = { ...defaultState }
	emit()
}
