import { useSyncExternalStore } from 'react'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { getVoiceState, setVoiceState, subscribeVoiceState } from '../voice/voiceStore'

export function VoiceSuggestionBanner() {
	const { listening, transcript, suggestion, processing, error } = useSyncExternalStore(
		subscribeVoiceState,
		getVoiceState,
		getVoiceState
	)
	const agent = useAgent()

	const handleAccept = () => {
		if (!suggestion) return
		// Use the combined transcript when available (multi-user), otherwise own transcript
		const prompt = suggestion.combinedTranscript ?? suggestion.transcript
		agent.interrupt({
			input: {
				agentMessages: [prompt],
				userMessages: [prompt],
				source: 'user',
			},
		})
		setVoiceState({ suggestion: null })
	}

	const handleReject = () => {
		setVoiceState({ suggestion: null })
	}

	const handleDismissError = () => {
		setVoiceState({ error: null })
	}

	return (
		<div className="voice-banner">
			{/* Status bar — always shown while panel is open */}
			<div className="voice-banner__status">
				{listening && !processing && !suggestion && (
					<span className="voice-banner__listening">
						<span className="voice-banner__dot" />
						{transcript ? `"${transcript}"` : 'Listening…'}
					</span>
				)}
				{processing && (
					<span className="voice-banner__processing">
						<span className="voice-banner__spinner" />
						Processing voice…
					</span>
				)}
				{error && (
					<span className="voice-banner__error">
						{error}
						<button className="voice-banner__dismiss" onClick={handleDismissError}>✕</button>
					</span>
				)}
			</div>

			{/* Suggestion card */}
			{suggestion && (
				<div className="voice-banner__suggestion">
					{suggestion.combinedTranscript && suggestion.combinedTranscript !== suggestion.transcript ? (
						<p className="voice-banner__heard"><em>{suggestion.combinedTranscript}</em></p>
					) : (
						<p className="voice-banner__heard">You said: <em>"{suggestion.transcript}"</em></p>
					)}
					<p className="voice-banner__description">{suggestion.description}</p>
					<div className="voice-banner__actions">
						<button className="voice-banner__accept" onClick={handleAccept}>
							✓ Apply
						</button>
						<button className="voice-banner__reject" onClick={handleReject}>
							✕ Dismiss
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
