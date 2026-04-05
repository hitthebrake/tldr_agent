import { useEffect, useRef } from 'react'
import { useEditor } from 'tldraw'
import { getVoiceState, resetVoiceState, setVoiceState, subscribeVoiceState } from './voiceStore'
import { VoiceCollabClient } from './VoiceCollabClient'

/** Rendered inside the Tldraw context. Manages microphone + collab voice flush. No visual output. */
export function VoiceController({ roomId }: { roomId: string }) {
	const editor = useEditor()
	const transcriptRef  = useRef('')
	const recognitionRef = useRef<any>(null)
	const collabRef      = useRef<VoiceCollabClient | null>(null)

	useEffect(() => {
		const SpeechRec =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

		if (!SpeechRec) {
			setVoiceState({ error: 'Speech recognition is not supported in this browser (use Chrome or Edge)' })
			return
		}

		// ── Voice collab WebSocket ───────────────────────────────────────────
		const collab = new VoiceCollabClient(roomId)
		collabRef.current = collab

		const unsubCollab = collab.onMessage((msg) => {
			if (msg.type === 'voice:processing') {
				setVoiceState({ processing: true, error: null })
			} else if (msg.type === 'voice:suggestion') {
				setVoiceState({
					processing: false,
					suggestion: {
						description: msg.description,
						transcript: transcriptRef.current.trim() || msg.combinedTranscript,
						combinedTranscript: msg.combinedTranscript,
					},
				})
			} else if (msg.type === 'voice:error') {
				setVoiceState({ processing: false, error: msg.error })
			} else if (msg.type === 'voice:clear') {
				setVoiceState({ suggestion: null })
			}
		})

		// ── Speech recognition ──────────────────────────────────────────────
		const recognition = new SpeechRec()
		recognition.continuous = true
		recognition.interimResults = true
		recognition.lang = 'en-US'

		recognition.onresult = (event: any) => {
			if (getVoiceState().callActive) return
			for (let i = event.resultIndex; i < event.results.length; i++) {
				if (event.results[i].isFinal) {
					const chunk = event.results[i][0].transcript.trim()
					if (!chunk) continue

					transcriptRef.current += chunk + ' '
					setVoiceState({ transcript: transcriptRef.current.trim() })

					// Send this chunk immediately so the server can accumulate
					// from all users in real time — don't wait for local silence.
					const shapes = editor
						.getCurrentPageShapes()
						.slice(0, 60)
						.map((shape) => {
							const b = editor.getShapePageBounds(shape)
							return {
								type: shape.type,
								id: shape.id,
								x: Math.round(b?.x ?? 0),
								y: Math.round(b?.y ?? 0),
								w: Math.round(b?.w ?? 0),
								h: Math.round(b?.h ?? 0),
							}
						})
					collab.sendTranscript(chunk, shapes)
				}
			}
		}

		recognition.onerror = (event: any) => {
			if (event.error === 'not-allowed') {
				setVoiceState({ error: 'Microphone permission denied', listening: false })
			}
		}

		let restartPending = false
		let intentionalStop = false
		recognition.onend = () => {
			if (intentionalStop || restartPending) return
			restartPending = true
			setTimeout(() => {
				restartPending = false
				if (intentionalStop) return
				try { recognition.start() } catch {}
			}, 200)
		}

		recognition.start()
		recognitionRef.current = recognition
		setVoiceState({ listening: true, error: null })

		// ── Pause/resume on manual call ──────────────────────────────────────
		let prevCallActive = getVoiceState().callActive
		const unsubCall = subscribeVoiceState(() => {
			const { callActive } = getVoiceState()
			if (!prevCallActive && callActive) {
				intentionalStop = true
				transcriptRef.current = ''
				try { recognition.stop() } catch {}
				setTimeout(() => { setVoiceState({ transcript: '', listening: false }) }, 0)
			} else if (prevCallActive && !callActive) {
				intentionalStop = false
				restartPending = false
				setTimeout(() => {
					setVoiceState({ listening: true })
					try { recognition.start() } catch {}
				}, 0)
			}
			prevCallActive = callActive
		})

		return () => {
			unsubCall()
			unsubCollab()
			collab.destroy()
			collabRef.current = null
			intentionalStop = true
			recognition.onend = null
			recognition.stop()
			recognitionRef.current = null
			resetVoiceState()
		}
	}, [editor, roomId])

	return null
}
